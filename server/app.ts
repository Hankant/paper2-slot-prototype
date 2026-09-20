/**
 * Durable SQLite + HTTP collection backend (see .agents/architecture.md).
 *
 * - node:http only; no external runtime dependencies.
 * - node:sqlite DatabaseSync is the durable authority; the seeded local-demo
 *   adapter replay provides event/order/gating semantics without weakening
 *   validation.
 * - Participant auth: random bearer token in an HttpOnly SameSite=Strict
 *   cookie; only its SHA-256 hash is stored. Admin export uses a separate
 *   Bearer token supplied via configuration.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import { COLLECTION_MATERIAL } from '../src/domain/collection-materials.js';
import path from 'node:path';
import { createRequire } from 'node:module';
// Vite 5 / vitest 1.6 cannot resolve node:sqlite at transform time: Node 24
// still marks it experimental, so it is absent from module.builtinModules and
// Vite mis-resolves the specifier as a file URL. createRequire bypasses the
// Vite resolver and loads the builtin natively at runtime.
const { DatabaseSync } = createRequire(import.meta.url)(
  'node:sqlite',
) as typeof import('node:sqlite');
import {
  CLIENT_VERSION,
  CONTRACT_VERSION,
  ContractError,
  parseEventEnvelope,
  type EntryCredential,
  type EventEnvelope,
  type SaveReceipt,
  type Session,
} from '@contracts';
import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from '../src/adapters/local-demo/one-trial-preview.js';

export interface CollectionServerOptions {
  databasePath: string;
  entryCode: string;
  adminToken: string;
  staticDir?: string;
  secureCookies?: boolean;
}

export interface CollectionServer {
  server: Server;
  close: () => Promise<void>;
}

interface SessionRow {
  session_id: string;
  session_json: string;
  entry_json: string;
  consent_version: string;
  token_hash: string;
  completed: number;
  advice_loaded: number;
  feedback_loaded: number;
  created_at: string;
}

interface EntryAck {
  consent_version: string;
  instructions_version: string;
  accepted_at: string;
  started_at: string;
}

interface AuditRecordInput {
  id: string;
  type: string;
  at_ms: number;
  data: unknown;
}

type PreviewAdapter = ReturnType<typeof createOneTrialPreview>;
interface LiveSession {
  adapter: PreviewAdapter;
  session: Session;
}

const COOKIE_NAME = 'collect_session';
const MAX_BODY_BYTES = 1_000_000;
const MAX_EVENTS_PER_BATCH = 200;
const MAX_AUDIT_PER_BATCH = 500;
const MAX_AUDIT_RECORD_BYTES = 32 * 1024;
const SESSION_CREATIONS_PER_MINUTE = 30;

/** Compare JSON content independent of object key insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Transport-level failure with an explicit status (no contract code fits). */
class HttpError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function statusForCode(code: string): number {
  switch (code) {
    case 'INVALID_ENTRY_CODE':
    case 'SESSION_EXPIRED':
      return 401;
    case 'EVENT_CONFLICT':
    case 'OUT_OF_ORDER':
      return 409;
    case 'RATE_LIMITED':
      return 429;
    case 'NETWORK_UNAVAILABLE':
      return 503;
    case 'PERSISTENCE_UNCONFIRMED':
      return 500;
    default:
      return 400;
  }
}

export function createCollectionServer(options: CollectionServerOptions): CollectionServer {
  if (!options.entryCode || options.entryCode.length < 4) {
    throw new Error('entryCode is required (no baked-in default credentials)');
  }
  if (!options.adminToken || options.adminToken.length < 8) {
    throw new Error('adminToken is required (no baked-in default credentials)');
  }
  const secureCookies = options.secureCookies === true;
  const staticRoot = options.staticDir ? path.resolve(options.staticDir) : null;

  const db = new DatabaseSync(options.databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      session_json TEXT NOT NULL,
      entry_json TEXT NOT NULL,
      consent_version TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      completed INTEGER NOT NULL DEFAULT 0,
      advice_loaded INTEGER NOT NULL DEFAULT 0,
      feedback_loaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      sequence_no INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (session_id, event_id),
      UNIQUE (session_id, sequence_no)
    );
    CREATE TABLE IF NOT EXISTS audit (
      session_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      at_ms INTEGER NOT NULL,
      body TEXT NOT NULL,
      persisted_at TEXT NOT NULL,
      PRIMARY KEY (session_id, audit_id)
    );
    CREATE TABLE IF NOT EXISTS receipts (
      receipt_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_seq ON events(session_id, sequence_no);
    CREATE INDEX IF NOT EXISTS idx_audit_session ON audit(session_id);
  `);

  const stmtFindByToken = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
  const stmtFindById = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
  const stmtInsertSession = db.prepare(
    'INSERT INTO sessions (session_id, session_json, entry_json, consent_version, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const stmtListSessions = db.prepare('SELECT * FROM sessions ORDER BY created_at ASC');
  const stmtInsertEvent = db.prepare(
    'INSERT INTO events (session_id, event_id, sequence_no, body) VALUES (?, ?, ?, ?)',
  );
  const stmtFindEvent = db.prepare('SELECT body FROM events WHERE session_id = ? AND event_id = ?');
  const stmtListEvents = db.prepare(
    'SELECT body FROM events WHERE session_id = ? ORDER BY sequence_no ASC',
  );
  const stmtUpdateFlags = db.prepare(
    'UPDATE sessions SET advice_loaded = ?, feedback_loaded = ? WHERE session_id = ?',
  );
  const stmtComplete = db.prepare('UPDATE sessions SET completed = 1 WHERE session_id = ?');
  const stmtInsertReceipt = db.prepare(
    'INSERT INTO receipts (receipt_id, session_id, kind, at_ms) VALUES (?, ?, ?, ?)',
  );
  const stmtFindAudit = db.prepare('SELECT body FROM audit WHERE session_id = ? AND audit_id = ?');
  const stmtInsertAudit = db.prepare(
    'INSERT INTO audit (session_id, audit_id, at_ms, body, persisted_at) VALUES (?, ?, ?, ?, ?)',
  );
  const stmtListAudit = db.prepare(
    'SELECT body FROM audit WHERE session_id = ? ORDER BY at_ms ASC, audit_id ASC',
  );

  /** Rebuilds the seeded adapter by replaying durable events (after restart). */
  const live = new Map<string, Promise<LiveSession>>();
  async function loadLive(row: SessionRow): Promise<LiveSession> {
    const cached = live.get(row.session_id);
    if (cached) return cached;
    const session = JSON.parse(row.session_json) as Session;
    const adapter = createOneTrialPreview({
      adviceForSelf: false,
      requireConsentVersion: row.consent_version,
      seedSession: session,
    });
    const credential: EntryCredential = {
      entry_code: 'PREVIEW-ONLY',
      observed_participation_mode: session.metadata.participation_mode,
      observed_device_class: session.metadata.device_class,
      client_versions: {
        protocol_version: session.protocol_version,
        contract_version: session.contract_version,
        material_version: session.material_version,
        client_version: CLIENT_VERSION,
      },
    };
    await adapter.sessionService.openSession(credential);
    const stored = stmtListEvents.all(row.session_id) as { body: string }[];
    for (const record of stored) {
      const event = JSON.parse(record.body) as EventEnvelope;
      if (event.event_type === 'advice_revealed' && row.advice_loaded === 1) {
        await adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID);
      }
      if (event.event_type === 'feedback_presented' && row.feedback_loaded === 1) {
        await adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID);
      }
      const replayed = await adapter.resultStore.saveEvents(session, [event]);
      if (replayed.rejected_events.length > 0) {
        // Durable state diverged from replay validation — refuse to continue.
        live.delete(row.session_id);
        throw new ContractError({
          code: 'PERSISTENCE_UNCONFIRMED',
          message: '持久化记录重放校验失败',
          retryable: 'no-retry',
        });
      }
    }
    if (row.advice_loaded === 1) await adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID);
    if (row.feedback_loaded === 1)
      await adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID);
    if (row.completed === 1) await adapter.sessionService.finishSession(session);
    const value: LiveSession = { adapter, session };
    live.set(row.session_id, Promise.resolve(value));
    return value;
  }

  /** Per-session serialization so validation + persistence stay atomic. */
  const locks = new Map<string, Promise<void>>();
  function withLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(sessionId) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    locks.set(
      sessionId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  const creationLimit = new Map<string, { count: number; resetAt: number }>();
  function rateLimited(ip: string): boolean {
    const now = Date.now();
    const entry = creationLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
      creationLimit.set(ip, { count: 1, resetAt: now + 60_000 });
      return false;
    }
    entry.count += 1;
    return entry.count > SESSION_CREATIONS_PER_MINUTE;
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(payload);
  }

  function sendError(res: ServerResponse, status: number, code: string, message: string): void {
    sendJson(res, status, { error: { code, message } });
  }

  function sendContractError(res: ServerResponse, error: ContractError): void {
    sendError(res, statusForCode(error.code), error.code, error.message);
  }

  function readBody(req: IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new HttpError(413, 'INVALID_EVENT', '请求体过大'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function readJson(req: IncomingMessage): Promise<unknown> {
    const raw = await readBody(req);
    if (raw.length === 0) return {};
    try {
      return JSON.parse(raw.toString('utf8')) as unknown;
    } catch {
      throw new ContractError({
        code: 'INVALID_EVENT',
        message: 'JSON 解析失败',
        retryable: 'retry',
      });
    }
  }

  function enforceSameOrigin(req: IncomingMessage): void {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) return;
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      throw new HttpError(403, 'INVALID_EVENT', '跨站请求被拒绝');
    }
    if (host !== req.headers.host) {
      throw new HttpError(403, 'INVALID_EVENT', '跨站请求被拒绝');
    }
  }

  function parseCookies(req: IncomingMessage): Record<string, string> {
    const header = req.headers.cookie;
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 0) continue;
      out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
    }
    return out;
  }

  function sessionRowFrom(raw: unknown): SessionRow {
    return raw as SessionRow;
  }

  function requireAuth(req: IncomingMessage): SessionRow | null {
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token) return null;
    const found = stmtFindByToken.get(sha256(token).toString('hex'));
    return found ? sessionRowFrom(found) : null;
  }

  function setSessionCookie(res: ServerResponse, token: string): void {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
    ];
    if (secureCookies) parts.push('Secure');
    res.setHeader('set-cookie', parts.join('; '));
  }

  function clearSessionCookie(res: ServerResponse): void {
    const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (secureCookies) parts.push('Secure');
    res.setHeader('set-cookie', parts.join('; '));
  }

  function snapshot(row: SessionRow, liveSession: LiveSession) {
    return {
      session: liveSession.session,
      events: liveSession.adapter.exportEvents(),
      entry: JSON.parse(row.entry_json) as EntryAck,
      completed: row.completed === 1,
    };
  }

  function validateCredential(value: unknown): EntryCredential {
    const credential = value as EntryCredential;
    const versions = credential?.client_versions;
    if (
      !credential ||
      typeof credential.entry_code !== 'string' ||
      !['on_site', 'remote'].includes(credential.observed_participation_mode) ||
      !['desktop', 'mobile', 'tablet', 'unknown'].includes(credential.observed_device_class) ||
      !versions ||
      versions.contract_version !== CONTRACT_VERSION ||
      versions.client_version !== CLIENT_VERSION ||
      versions.material_version !== '0.3.0' ||
      versions.protocol_version !== 'unreleased'
    ) {
      throw new ContractError({
        code: 'INVALID_EVENT',
        message: '凭证格式不正确',
        retryable: 'no-retry',
      });
    }
    return credential;
  }

  function validateEntryAck(value: unknown): EntryAck {
    const entry = value as EntryAck;
    if (
      !entry ||
      entry.consent_version !== COLLECTION_MATERIAL.consentVersion ||
      entry.instructions_version !== COLLECTION_MATERIAL.instructionsVersion ||
      typeof entry.accepted_at !== 'string' ||
      !Number.isFinite(Date.parse(entry.accepted_at)) ||
      typeof entry.started_at !== 'string' ||
      !Number.isFinite(Date.parse(entry.started_at)) ||
      Date.parse(entry.started_at) < Date.parse(entry.accepted_at)
    ) {
      throw new ContractError({
        code: 'INVALID_EVENT',
        message: '参与确认格式不正确',
        retryable: 'no-retry',
      });
    }
    // Only acknowledged material fields are stored, never the entry code.
    return {
      consent_version: entry.consent_version,
      instructions_version: entry.instructions_version,
      accepted_at: entry.accepted_at,
      started_at: entry.started_at,
    };
  }

  function durableReceipt(
    receipt: SaveReceipt,
    row: SessionRow,
    receiptId: string,
    persistedAt: string,
  ): SaveReceipt {
    const completed = row.completed === 1;
    return {
      ...receipt,
      persistence_scope: 'remote',
      persisted_at: persistedAt,
      receipt_id: receiptId,
      session_status: completed ? 'completed' : receipt.session_status,
      current_phase: completed ? 'completed' : receipt.current_phase,
    };
  }

  async function exportShape(row: SessionRow) {
    const liveSession = await loadLive(row);
    const events = liveSession.adapter.exportEvents();
    const hasFinal = events.some((event) => event.event_type === 'final_prediction_submitted');
    const feedback = hasFinal
      ? await liveSession.adapter.trialService.getFeedback(liveSession.session, PREVIEW_TRIAL_ID)
      : null;
    const auditRows = stmtListAudit.all(row.session_id) as { body: string }[];
    return {
      session: liveSession.session,
      events,
      entry: JSON.parse(row.entry_json) as EntryAck,
      completed: row.completed === 1,
      presentation_audit: auditRows.map((record) => JSON.parse(record.body) as AuditRecordInput),
      feedback,
    };
  }

  async function handleApi(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    enforceSameOrigin(req);
    if (
      method === 'POST' &&
      req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json'
    ) {
      throw new HttpError(415, 'INVALID_EVENT', '需要 application/json');
    }

    if (method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true, storage: 'sqlite', simulation: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/session') {
      if (rateLimited(req.socket.remoteAddress ?? 'unknown')) {
        sendError(res, 429, 'RATE_LIMITED', '会话创建过于频繁');
        return;
      }
      const existing = requireAuth(req);
      if (existing) {
        // Existing authenticated cookie resumes the session, preserving events.
        const liveSession = await loadLive(existing);
        sendJson(res, 200, snapshot(existing, liveSession));
        return;
      }
      const body = (await readJson(req)) as { credential?: unknown; entry?: unknown };
      const credential = validateCredential(body?.credential);
      const entry = validateEntryAck(body?.entry);
      if (credential.entry_code !== options.entryCode) {
        throw new ContractError({
          code: 'INVALID_ENTRY_CODE',
          message: '入场码无效',
          retryable: 'user-action',
        });
      }
      if (credential.client_versions.contract_version !== CONTRACT_VERSION) {
        throw new ContractError({
          code: 'INVALID_EVENT',
          message: '接口版本不匹配',
          retryable: 'no-retry',
        });
      }
      const adapter = createOneTrialPreview({
        adviceForSelf: false,
        requireConsentVersion: entry.consent_version,
        seedSession: {
          participant_id: randomUUID(),
          recruitment_batch: 'collection-pilot',
          metadata: {
            participation_mode: credential.observed_participation_mode,
            device_class: credential.observed_device_class,
            recruitment_batch: 'collection-pilot',
            adapter_version: '0.3.0',
            provider: 'sqlite-collection',
          },
          provider: 'sqlite-collection',
        },
      });
      // The seeded replay adapter pins its own preview entry code; the server
      // validates the configured collection code itself above.
      const session = await adapter.sessionService.openSession({
        ...credential,
        entry_code: 'PREVIEW-ONLY',
      });
      const token = randomBytes(32).toString('base64url');
      const createdAt = new Date().toISOString();
      stmtInsertSession.run(
        session.session_id,
        JSON.stringify(session),
        JSON.stringify(entry),
        entry.consent_version,
        sha256(token).toString('hex'),
        createdAt,
      );
      const row = sessionRowFrom(stmtFindById.get(session.session_id));
      live.set(session.session_id, Promise.resolve({ adapter, session }));
      setSessionCookie(res, token);
      sendJson(res, 200, snapshot(row, { adapter, session }));
      return;
    }

    if (method === 'POST' && pathname === '/api/logout') {
      await readJson(req);
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    const row = requireAuth(req);
    if (!row) {
      sendError(res, 401, 'SESSION_EXPIRED', '未认证或会话已失效');
      return;
    }

    switch (`${method} ${pathname}`) {
      case 'GET /api/session': {
        const liveSession = await loadLive(row);
        sendJson(res, 200, snapshot(row, liveSession));
        return;
      }
      case 'GET /api/trial': {
        const liveSession = await loadLive(row);
        const trial = await liveSession.adapter.trialService.loadTrial(
          liveSession.session,
          PREVIEW_TRIAL_ID,
        );
        sendJson(res, 200, trial);
        return;
      }
      case 'GET /api/advice': {
        const liveSession = await loadLive(row);
        const advice = await liveSession.adapter.trialService.loadAdvice(
          liveSession.session,
          PREVIEW_TRIAL_ID,
        );
        if (row.advice_loaded !== 1) {
          stmtUpdateFlags.run(1, row.feedback_loaded, row.session_id);
        }
        sendJson(res, 200, advice);
        return;
      }
      case 'GET /api/feedback': {
        const liveSession = await loadLive(row);
        const feedback = await liveSession.adapter.trialService.getFeedback(
          liveSession.session,
          PREVIEW_TRIAL_ID,
        );
        if (row.feedback_loaded !== 1) {
          stmtUpdateFlags.run(row.advice_loaded, 1, row.session_id);
        }
        sendJson(res, 200, feedback);
        return;
      }
      case 'POST /api/events': {
        const body = (await readJson(req)) as { events?: unknown };
        const incoming = body?.events;
        if (
          !Array.isArray(incoming) ||
          incoming.length === 0 ||
          incoming.length > MAX_EVENTS_PER_BATCH
        ) {
          throw new ContractError({
            code: 'INVALID_EVENT',
            message: '事件批次格式不正确',
            retryable: 'no-retry',
          });
        }
        const parsed: EventEnvelope[] = [];
        for (const candidate of incoming) {
          const event = parseEventEnvelope(candidate);
          if (event.session_id !== row.session_id) {
            throw new ContractError({
              code: 'INVALID_EVENT',
              message: '事件身份不匹配',
              retryable: 'no-retry',
            });
          }
          parsed.push(event);
        }
        const receipt = await withLock(row.session_id, async () => {
          Object.assign(row, stmtFindById.get(row.session_id));
          const liveSession = await loadLive(row);
          const batchIds = new Set<string>();
          for (const event of parsed) {
            if (batchIds.has(event.event_id))
              throw new HttpError(409, 'EVENT_CONFLICT', '批次内事件 ID 重复');
            batchIds.add(event.event_id);
          }
          const memoryReceipt = await liveSession.adapter.resultStore.saveEvents(
            liveSession.session,
            incoming as EventEnvelope[],
          );
          const fresh = memoryReceipt.acknowledged_event_ids.filter(
            (id) => !(stmtFindEvent.get(row.session_id, id) as { body: string } | undefined),
          );
          const receiptId = randomUUID();
          const persistedAt = new Date().toISOString();
          try {
            db.exec('BEGIN IMMEDIATE');
            for (const id of fresh) {
              const event = parsed.find((candidate) => candidate.event_id === id);
              if (!event) continue;
              stmtInsertEvent.run(row.session_id, id, event.sequence_no, JSON.stringify(event));
            }
            let adviceLoaded = row.advice_loaded;
            let feedbackLoaded = row.feedback_loaded;
            for (const event of parsed) {
              if (memoryReceipt.acknowledged_event_ids.includes(event.event_id)) {
                if (event.event_type === 'advice_revealed') adviceLoaded = 1;
                if (event.event_type === 'feedback_presented') feedbackLoaded = 1;
              }
            }
            stmtUpdateFlags.run(adviceLoaded, feedbackLoaded, row.session_id);
            stmtInsertReceipt.run(receiptId, row.session_id, 'events', Date.now());
            db.exec('COMMIT');
            row.advice_loaded = adviceLoaded;
            row.feedback_loaded = feedbackLoaded;
          } catch (error) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // connection-level failure; nothing to roll back
            }
            live.delete(row.session_id); // re-validate from durable state next time
            throw error;
          }
          // Rejected records must not remain accepted only in memory.
          if (memoryReceipt.rejected_events.length > 0) live.delete(row.session_id);
          return durableReceipt(memoryReceipt, row, receiptId, persistedAt);
        });
        sendJson(res, 200, receipt);
        return;
      }
      case 'POST /api/audit': {
        const body = (await readJson(req)) as { records?: unknown };
        const records = body?.records;
        if (
          !Array.isArray(records) ||
          records.length === 0 ||
          records.length > MAX_AUDIT_PER_BATCH
        ) {
          throw new ContractError({
            code: 'INVALID_EVENT',
            message: '审计记录批次格式不正确',
            retryable: 'no-retry',
          });
        }
        const normalized: { record: AuditRecordInput; canonical: string }[] = [];
        for (const candidate of records) {
          const record = candidate as AuditRecordInput;
          if (
            !record ||
            typeof record.id !== 'string' ||
            record.id.length === 0 ||
            record.id.length > 128 ||
            typeof record.type !== 'string' ||
            record.type.length === 0 ||
            record.type.length > 128 ||
            typeof record.at_ms !== 'number' ||
            !Number.isInteger(record.at_ms) ||
            record.at_ms < 0
          ) {
            throw new ContractError({
              code: 'INVALID_EVENT',
              message: '审计记录格式不正确',
              retryable: 'no-retry',
            });
          }
          const serialized = canonical(record);
          if (
            normalized.some((item) => item.record.id === record.id && item.canonical !== serialized)
          ) {
            throw new HttpError(409, 'EVENT_CONFLICT', '批次内审计 ID 内容冲突');
          }
          if (serialized.length > MAX_AUDIT_RECORD_BYTES) {
            throw new ContractError({
              code: 'INVALID_EVENT',
              message: '审计记录过大',
              retryable: 'no-retry',
            });
          }
          const existing = stmtFindAudit.get(row.session_id, record.id) as
            { body: string } | undefined;
          if (existing && existing.body !== serialized) {
            throw new ContractError({
              code: 'EVENT_CONFLICT',
              message: '同一审计记录 ID 的内容发生变化',
              retryable: 'no-retry',
            });
          }
          normalized.push({ record, canonical: serialized });
        }
        const receiptId = randomUUID();
        const persistedAt = new Date().toISOString();
        db.exec('BEGIN IMMEDIATE');
        try {
          for (const { record, canonical: serialized } of normalized) {
            const existing = stmtFindAudit.get(row.session_id, record.id) as
              { body: string } | undefined;
            if (!existing) {
              stmtInsertAudit.run(row.session_id, record.id, record.at_ms, serialized, persistedAt);
            }
          }
          stmtInsertReceipt.run(receiptId, row.session_id, 'audit', Date.now());
          db.exec('COMMIT');
        } catch (error) {
          try {
            db.exec('ROLLBACK');
          } catch {
            // ignore
          }
          throw error;
        }
        sendJson(res, 200, {
          acknowledged_ids: normalized.map(({ record }) => record.id),
          persisted_at: persistedAt,
          receipt_id: receiptId,
        });
        return;
      }
      case 'POST /api/finish': {
        await readJson(req);
        const receipt = await withLock(row.session_id, async () => {
          const liveSession = await loadLive(row);
          const memoryReceipt = await liveSession.adapter.sessionService.finishSession(
            liveSession.session,
          );
          const receiptId = randomUUID();
          const persistedAt = new Date().toISOString();
          db.exec('BEGIN IMMEDIATE');
          try {
            stmtComplete.run(row.session_id);
            stmtInsertReceipt.run(receiptId, row.session_id, 'finish', Date.now());
            db.exec('COMMIT');
            row.completed = 1;
          } catch (error) {
            try {
              db.exec('ROLLBACK');
            } catch {
              // ignore
            }
            live.delete(row.session_id);
            throw error;
          }
          return durableReceipt(memoryReceipt, row, receiptId, persistedAt);
        });
        sendJson(res, 200, receipt);
        return;
      }
      case 'GET /api/export': {
        sendJson(res, 200, {
          simulation: true,
          persistence_scope: 'remote',
          ...(await exportShape(row)),
        });
        return;
      }
      default:
        sendError(res, 404, 'INVALID_EVENT', '未知接口');
    }
  }

  function adminAuthorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? '';
    const match = /^Bearer\s+(.+)$/.exec(header);
    if (!match || !match[1]) return false;
    const presented = sha256(match[1].trim());
    const expected = sha256(options.adminToken);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }

  function csvCell(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    const text = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
    if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  async function handleAdminExport(
    req: IncomingMessage,
    res: ServerResponse,
    query: URLSearchParams,
  ): Promise<void> {
    if (!adminAuthorized(req)) {
      sendError(res, 401, 'SESSION_EXPIRED', '管理凭证无效');
      return;
    }
    const rows = stmtListSessions.all() as unknown as SessionRow[];
    const shapes = await Promise.all(rows.map((row) => exportShape(row)));
    if (query.get('format') === 'csv') {
      const header = [
        'session_id',
        'participant_id',
        'participation_mode',
        'device_class',
        'recruitment_batch',
        'consent_version',
        'event_count',
        'audit_count',
        'completed',
        'independent_machine',
        'final_machine',
        'actual_winner_machine_id',
        'independent_correct',
        'final_correct',
        'points_awarded',
        'created_at',
        'source_choice',
        'confidence_percent',
        'advice_exposed',
        'advice_target_machine_id',
        'advice_correct',
        'independent_matches_advice',
        'final_matches_advice',
        'switched_to_advice',
      ];
      const lines = [header.join(',')];
      for (const shape of shapes) {
        const independent = shape.events.find((e) => e.event_type === 'prediction_submitted');
        const final = shape.events.find((e) => e.event_type === 'final_prediction_submitted');
        const source = shape.events.find((e) => e.event_type === 'source_selected');
        const confidence = shape.events.find((e) => e.event_type === 'confidence_submitted');
        const evaluation = shape.feedback?.advice_evaluation;
        lines.push(
          [
            csvCell(shape.session.session_id),
            csvCell(shape.session.participant_id),
            csvCell(shape.session.metadata.participation_mode),
            csvCell(shape.session.metadata.device_class),
            csvCell(shape.session.recruitment_batch),
            csvCell(shape.entry.consent_version),
            csvCell(shape.events.length),
            csvCell(shape.presentation_audit.length),
            csvCell(shape.completed),
            csvCell(independent ? (independent.payload as { machine_id?: string }).machine_id : ''),
            csvCell(final ? (final.payload as { machine_id?: string }).machine_id : ''),
            csvCell(shape.feedback ? shape.feedback.actual_winner_machine_id : ''),
            csvCell(shape.feedback ? shape.feedback.independent_correct : ''),
            csvCell(shape.feedback ? shape.feedback.final_correct : ''),
            csvCell(shape.feedback ? shape.feedback.points_awarded : ''),
            csvCell(
              shape.session
                ? (rows.find((r) => r.session_id === shape.session.session_id)?.created_at ?? '')
                : '',
            ),
            csvCell(source?.payload.source),
            csvCell(confidence?.payload.confidence_percent),
            csvCell(evaluation?.advice_exposed),
            csvCell(evaluation?.advice_target_machine_id),
            csvCell(evaluation?.advice_correct),
            csvCell(evaluation?.independent_matches_advice),
            csvCell(evaluation?.final_matches_advice),
            csvCell(evaluation?.switched_to_advice),
          ].join(','),
        );
      }
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(lines.join('\r\n'));
      return;
    }
    sendJson(res, 200, { simulation: true, sessions: shapes });
  }

  const CONTENT_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  async function serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<boolean> {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendError(res, 400, 'INVALID_EVENT', '路径不合法');
      return true;
    }
    const segments = decoded.split('/').filter((segment) => segment.length > 0);
    if (segments.some((segment) => segment.startsWith('.') || segment === '..')) {
      sendError(res, 403, 'INVALID_EVENT', '禁止访问');
      return true;
    }
    const relative = segments.join(path.sep);
    let target = path.resolve(staticRoot, relative);
    if (target !== staticRoot && !target.startsWith(staticRoot + path.sep)) {
      sendError(res, 403, 'INVALID_EVENT', '禁止访问');
      return true;
    }
    try {
      const info = await stat(target);
      if (info.isDirectory()) target = path.join(target, 'index.html');
    } catch {
      // fall through to read attempt
    }
    if (path.extname(target) === '.map') {
      sendError(res, 403, 'INVALID_EVENT', '禁止访问');
      return true;
    }
    try {
      const resolved = await realpath(target);
      const realRoot = await realpath(staticRoot);
      if (!resolved.startsWith(realRoot + path.sep) || !CONTENT_TYPES[path.extname(resolved)]) {
        sendError(res, 403, 'INVALID_EVENT', '禁止访问');
        return true;
      }
      const content = await readFile(target);
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(content);
    } catch {
      sendError(res, 404, 'INVALID_EVENT', '资源不存在');
    }
    return true;
  }

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const pathname = url.pathname;
        if (pathname === '/api/admin/export') {
          if (req.method !== 'GET') {
            sendError(res, 404, 'INVALID_EVENT', '未知接口');
            return;
          }
          await handleAdminExport(req, res, url.searchParams);
          return;
        }
        if (pathname === '/api' || pathname.startsWith('/api/')) {
          if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'HEAD') {
            sendError(res, 404, 'INVALID_EVENT', '未知接口');
            return;
          }
          await handleApi(req, res, pathname);
          return;
        }
        if (await serveStatic(req, res, pathname)) return;
        sendError(res, 404, 'INVALID_EVENT', '资源不存在');
      } catch (error) {
        if (error instanceof HttpError) {
          sendError(res, error.status, error.code, error.message);
          return;
        }
        if (error instanceof ContractError) {
          sendContractError(res, error);
          return;
        }
        // No stacks or internals leak to clients.
        console.error(
          '[collection-server] unexpected error:',
          error instanceof Error ? error.message : String(error),
        );
        if (!res.headersSent) {
          sendError(res, 500, 'PERSISTENCE_UNCONFIRMED', '服务器内部错误');
        } else {
          res.end();
        }
      }
    })();
  });

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    live.clear();
    locks.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    db.close();
  }

  return { server, close };
}
