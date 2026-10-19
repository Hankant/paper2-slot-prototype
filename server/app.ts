import { adminConfigSchema, type AdminConfig } from '../src/domain/admin-config.js';
import { createExperimentPlan } from '../src/domain/experiment-plan.js';
import { QUESTIONNAIRE_INSTRUMENT } from '../src/domain/questionnaire-instrument-demo.js';
import { rewardCode } from '../src/domain/reward-code.js';
import {
  experimentPlanSchema,
  trialIds,
  type ExperimentPlan,
} from '../src/contracts/experiment-plan.js';
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
import { createHash, randomBytes, randomUUID, randomInt, timingSafeEqual } from 'node:crypto';
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
  type PerformanceReference,
  type TrialFeedback,
} from '@contracts';
import { evaluateAdvice } from '../src/domain/advice-evaluation.js';
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
  performanceReference?: PerformanceReference;
  practiceRequired?: boolean;
  experimentPlan?: ExperimentPlan;
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
  private_seed: string;
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
// Campus NAT and the deployed reverse proxy can share one socket address.
// Allow a 50-person admission burst plus retry headroom; keep a bounded limit.
// Do not trust arbitrary X-Forwarded-For headers to bypass this protection.
const SESSION_CREATIONS_PER_MINUTE = 120;

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
  const performanceReference: PerformanceReference = options.performanceReference ?? {
    condition_id: 'human-55_ai-plus5',
    human_average_hit_rate: 0.55,
    ai_hit_rate: 0.6,
    ai_accuracy_tier: 'plus_5pp',
    points_per_correct: 10,
    reward_per_point_cny: null,
  };
  const configuredPlan = options.experimentPlan
    ? experimentPlanSchema.parse(options.experimentPlan)
    : undefined;
  const practiceRequired = options.practiceRequired === true;
  const staticRoot = options.staticDir ? path.resolve(options.staticDir) : null;

  const db = new DatabaseSync(options.databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS config_revisions (
      revision INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, created_at TEXT NOT NULL
    );
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
    CREATE TABLE IF NOT EXISTS trial_access (
      session_id TEXT NOT NULL, trial_id TEXT NOT NULL, advice_loaded INTEGER NOT NULL DEFAULT 0,
      feedback_loaded INTEGER NOT NULL DEFAULT 0, feedback_json TEXT,
      PRIMARY KEY(session_id,trial_id)
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

  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
  if (!sessionColumns.some((c) => c.name === 'private_seed'))
    db.exec("ALTER TABLE sessions ADD COLUMN private_seed TEXT NOT NULL DEFAULT ''");
  const stmtAccess = db.prepare('SELECT * FROM trial_access WHERE session_id = ?');
  const stmtAdviceAccess = db.prepare(
    'INSERT INTO trial_access(session_id,trial_id,advice_loaded) VALUES(?,?,1) ON CONFLICT(session_id,trial_id) DO UPDATE SET advice_loaded=1',
  );
  const stmtFeedbackAccess = db.prepare(
    'INSERT INTO trial_access(session_id,trial_id,feedback_loaded,feedback_json) VALUES(?,?,1,?) ON CONFLICT(session_id,trial_id) DO UPDATE SET feedback_loaded=1, feedback_json=excluded.feedback_json',
  );
  const stmtFindByToken = db.prepare('SELECT * FROM sessions WHERE token_hash = ?');
  const stmtFindById = db.prepare('SELECT * FROM sessions WHERE session_id = ?');
  const stmtInsertSession = db.prepare(
    'INSERT INTO sessions (session_id, session_json, entry_json, consent_version, token_hash, created_at, private_seed) VALUES (?, ?, ?, ?, ?, ?, ?)',
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

  function activeConfig(): { revision: number; config: AdminConfig } | null {
    const row = db
      .prepare('SELECT revision,body FROM config_revisions ORDER BY revision DESC LIMIT 1')
      .get() as { revision: number; body: string } | undefined;
    return row
      ? { revision: row.revision, config: adminConfigSchema.parse(JSON.parse(row.body)) }
      : null;
  }
  if (configuredPlan && !activeConfig()) {
    const initial = adminConfigSchema.parse({
      name: '初始配置',
      plan: configuredPlan,
      conditions: [performanceReference],
    });
    db.prepare('INSERT INTO config_revisions(body,created_at) VALUES(?,?)').run(
      JSON.stringify(initial),
      new Date().toISOString(),
    );
  }
  function configResponse() {
    const active = activeConfig();
    return {
      revision: active?.revision ?? 0,
      config: active?.config ?? {
        name: '新实验配置',
        plan: createExperimentPlan(),
        conditions: [performanceReference],
      },
      questionnaire_blocks: QUESTIONNAIRE_INSTRUMENT.blocks.map((b) => ({
        id: b.id,
        title: b.title,
        position: b.position,
        instrument_version: QUESTIONNAIRE_INSTRUMENT.version,
      })),
    };
  }
  function adminSessions() {
    return (stmtListSessions.all() as unknown as SessionRow[]).map((row) => {
      const session = JSON.parse(row.session_json) as Session;
      const events = (stmtListEvents.all(row.session_id) as { body: string }[]).map(
        (r) => JSON.parse(r.body) as EventEnvelope,
      );
      const access = stmtAccess.all(row.session_id) as {
        trial_id: string;
        feedback_json: string | null;
      }[];
      const results = access.flatMap((a) =>
        a.feedback_json ? [JSON.parse(a.feedback_json) as TrialFeedback] : [],
      );
      const modules = session.experiment_plan?.modules ?? [];
      const blocks = modules.flatMap((m) => (m.kind === 'trials' ? [m.block] : []));
      const formalIds = new Set(
        blocks.filter((b) => !b.scores_excluded_from_formal).flatMap(trialIds),
      );
      const formalPoints = results
        .filter((f) => !session.experiment_plan || formalIds.has(f.trial_id))
        .reduce((n, f) => n + f.points_awarded, 0);
      const rate = session.condition_assignment?.reward_per_point_cny ?? null;
      const finished = events.filter((e) => e.event_type === 'feedback_presented').length;
      const questionnaires = events.filter((e) => e.event_type === 'questionnaire_block_submitted');
      const errors = questionnaires.reduce(
        (n, e) =>
          n +
          (e.event_type === 'questionnaire_block_submitted'
            ? (e.payload.comprehension_errors ?? []).reduce((a, b) => a + b.incorrect_count, 0)
            : 0),
        0,
      );
      const last = db
        .prepare('SELECT MAX(at_ms) AS last FROM receipts WHERE session_id=?')
        .get(row.session_id) as { last: number | null };
      const updated = last.last === null ? row.created_at : new Date(last.last).toISOString();
      const issues: string[] = [];
      if (session.contract_version !== CONTRACT_VERSION) issues.push('旧版会话');
      if (errors) issues.push('理解检验曾答错');
      if (!row.completed && Date.now() - Date.parse(updated) > 15 * 60 * 1000)
        issues.push('超过15分钟未更新');
      if (
        row.completed &&
        blocks.length &&
        finished !== blocks.reduce((n, b) => n + b.total_trials, 0)
      )
        issues.push('轮次记录不完整');
      const completedModules = modules.filter((m) =>
        m.kind === 'trials'
          ? events.some(
              (e) => e.event_type === 'block_completed' && e.payload.block_id === m.block.block_id,
            )
          : m.block_ids.every((id) =>
              questionnaires.some(
                (e) =>
                  e.event_type === 'questionnaire_block_submitted' && e.payload.block_id === id,
              ),
            ),
      ).length;
      return {
        session_id: session.session_id,
        reward_code: row.completed ? rewardCode(session.session_id) : null,
        condition_id: session.group_assignment,
        configuration_revision: session.configuration_revision ?? 0,
        assignment_method: session.assignment_method ?? 'legacy',
        completed: row.completed === 1,
        created_at: row.created_at,
        updated_at: updated,
        device_class: session.metadata.device_class,
        participation_mode: session.metadata.participation_mode,
        completed_trials: finished,
        total_trials: blocks.length ? blocks.reduce((n, b) => n + b.total_trials, 0) : 1,
        completed_modules: completedModules,
        total_modules: modules.length,
        questionnaire_blocks: questionnaires.length,
        comprehension_errors: errors,
        formal_points: formalPoints,
        reward_cny: rate === null ? null : Math.round(formalPoints * rate * 100) / 100,
        issues,
      };
    });
  }
  async function handleAdmin(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
  ): Promise<void> {
    enforceSameOrigin(req);
    if (!adminAuthorized(req)) {
      sendError(res, 401, 'SESSION_EXPIRED', '管理凭证无效');
      return;
    }
    if (req.method === 'GET' && pathname === '/api/admin/config') {
      sendJson(res, 200, configResponse());
      return;
    }
    if (req.method === 'GET' && pathname === '/api/admin/sessions') {
      sendJson(res, 200, { sessions: adminSessions() });
      return;
    }
    if (req.method === 'POST' && pathname === '/api/admin/config') {
      if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
        throw new HttpError(415, 'INVALID_EVENT', '需要 application/json');
      const body = (await readJson(req)) as { expected_revision?: unknown; config?: unknown };
      const parsed = adminConfigSchema.safeParse(body?.config);
      if (!parsed.success)
        throw new HttpError(
          400,
          'INVALID_EVENT',
          parsed.error.issues.map((i) => i.message).join('；'),
        );
      const current = activeConfig()?.revision ?? 0;
      if (body.expected_revision !== current)
        throw new HttpError(409, 'EVENT_CONFLICT', '配置已在其他页面更新，请刷新配置后重新编辑');
      db.prepare('INSERT INTO config_revisions(body,created_at) VALUES(?,?)').run(
        JSON.stringify(parsed.data),
        new Date().toISOString(),
      );
      sendJson(res, 200, configResponse());
      return;
    }
    sendError(res, 404, 'INVALID_EVENT', '未知管理接口');
  }

  /** Rebuilds the seeded adapter by replaying durable events (after restart). */
  const live = new Map<string, Promise<LiveSession>>();
  async function loadLive(row: SessionRow): Promise<LiveSession> {
    const cached = live.get(row.session_id);
    if (cached) return cached;
    const session = JSON.parse(row.session_json) as Session;
    if (session.contract_version !== CONTRACT_VERSION)
      throw new HttpError(
        409,
        'INVALID_EVENT',
        '此会话使用旧版流程，旧记录仍保留。请开始新版体验。',
      );
    const adapter = createOneTrialPreview({
      adviceForSelf: false,
      requireConsentVersion: row.consent_version,
      requirePractice: practiceRequired,
      performanceReference,
      privateSeed: row.private_seed,
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
    const access = stmtAccess.all(row.session_id) as {
      trial_id: string;
      advice_loaded: number;
      feedback_loaded: number;
    }[];
    const loadedAdvice = (id: string) =>
      session.experiment_plan
        ? access.some((a) => a.trial_id === id && a.advice_loaded === 1)
        : row.advice_loaded === 1;
    const loadedFeedback = (id: string) =>
      session.experiment_plan
        ? access.some((a) => a.trial_id === id && a.feedback_loaded === 1)
        : row.feedback_loaded === 1;
    const stored = stmtListEvents.all(row.session_id) as { body: string }[];
    for (const record of stored) {
      const event = JSON.parse(record.body) as EventEnvelope;
      if (event.event_type === 'advice_revealed' && loadedAdvice(event.trial_id ?? '')) {
        await adapter.trialService.loadAdvice(session, event.trial_id ?? '');
      }
      if (event.event_type === 'feedback_presented' && loadedFeedback(event.trial_id ?? '')) {
        await adapter.trialService.getFeedback(session, event.trial_id ?? '');
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
    for (const a of access) {
      if (a.advice_loaded) await adapter.trialService.loadAdvice(session, a.trial_id);
      if (a.feedback_loaded) await adapter.trialService.getFeedback(session, a.trial_id);
    }
    if (!session.experiment_plan && row.advice_loaded === 1)
      await adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID);
    if (!session.experiment_plan && row.feedback_loaded === 1)
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
  const validationLimit = new Map<string, { count: number; resetAt: number }>();
  function rateLimited(ip: string, bucket = creationLimit): boolean {
    const now = Date.now();
    const entry = bucket.get(ip);
    if (!entry || entry.resetAt <= now) {
      bucket.set(ip, { count: 1, resetAt: now + 60_000 });
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
    const storedSession = JSON.parse(row.session_json) as Session;
    const storedRows = stmtListEvents.all(row.session_id) as { body: string }[];
    const storedEvents = storedRows.map((record) => JSON.parse(record.body) as EventEnvelope);
    const isCurrentContract = storedSession.contract_version === CONTRACT_VERSION;
    const liveSession = isCurrentContract ? await loadLive(row) : null;
    const session = liveSession?.session ?? storedSession;
    const events = liveSession?.adapter.exportEvents() ?? storedEvents;
    const hasFinal = events.some((event) => event.event_type === 'final_prediction_submitted');
    let feedback: TrialFeedback | null = null;
    const feedbacks: TrialFeedback[] = [];
    if (hasFinal && liveSession) {
      for (const e of events)
        if (e.event_type === 'final_prediction_submitted' && e.trial_id) {
          const result = await liveSession.adapter.trialService.getFeedback(
            liveSession.session,
            e.trial_id,
          );
          feedbacks.push(result);
          stmtFeedbackAccess.run(row.session_id, e.trial_id, JSON.stringify(result));
        }
      feedback = feedbacks.at(-1) ?? null;
    } else if (session.experiment_plan) {
      const saved = stmtAccess.all(row.session_id) as { feedback_json: string | null }[];
      for (const item of saved)
        if (item.feedback_json) feedbacks.push(JSON.parse(item.feedback_json) as TrialFeedback);
      feedback = feedbacks.at(-1) ?? null;
    } else if (hasFinal) {
      const independent = events.find((event) => event.event_type === 'prediction_submitted');
      const final = events.find((event) => event.event_type === 'final_prediction_submitted');
      if (
        independent?.event_type === 'prediction_submitted' &&
        final?.event_type === 'final_prediction_submitted'
      ) {
        const winner = 'C';
        const exposed = events.some((event) => event.event_type === 'advice_revealed');
        const evaluation = evaluateAdvice({
          exposed,
          target: 'B',
          winner,
          independent: independent.payload.machine_id,
          final: final.payload.machine_id,
        });
        feedback = {
          trial_id: PREVIEW_TRIAL_ID,
          actual_winner_machine_id: winner,
          participant_predicted_winner: final.payload.machine_id === winner,
          advice_target_hit: null,
          advice_actual_hit: evaluation.advice_correct,
          advice_evaluation: evaluation,
          points_awarded: final.payload.machine_id === winner ? 10 : 0,
          scoring_version: '0.3.1',
          independent_correct: independent.payload.machine_id === winner,
          final_correct: final.payload.machine_id === winner,
          required_event_types: [],
        };
      }
    }
    if (!feedbacks.length && feedback) feedbacks.push(feedback);
    const planned = session.experiment_plan?.modules.flatMap((m) =>
      m.kind === 'trials'
        ? trialIds(m.block).map((id, i) => ({ id, index: i, block: m.block }))
        : [],
    ) ?? [{ id: PREVIEW_TRIAL_ID, index: 0, block: null }];
    const trialResults = planned
      .filter((t) => events.some((e) => e.trial_id === t.id))
      .map((t) => {
        const perTrial = events.filter((e) => e.trial_id === t.id);
        const prediction = perTrial.find((e) => e.event_type === 'prediction_submitted');
        const final = perTrial.find((e) => e.event_type === 'final_prediction_submitted');
        const source = perTrial.find((e) => e.event_type === 'source_selected');
        const confidence = perTrial.find((e) => e.event_type === 'confidence_submitted');
        return {
          trial_id: t.id,
          block_id: t.block?.block_id ?? 'legacy',
          block_kind: t.block?.block_kind ?? 'formal',
          trial_index_in_block: t.index,
          scores_excluded_from_formal: t.block?.scores_excluded_from_formal ?? false,
          condition_assignment: session.condition_assignment,
          independent: prediction?.payload.machine_id ?? null,
          final: final?.payload.machine_id ?? null,
          source: source?.payload.source ?? null,
          confidence: confidence?.payload.confidence_percent ?? null,
          feedback: feedbacks.find((f) => f.trial_id === t.id) ?? null,
          feedback_presented: perTrial.some((e) => e.event_type === 'feedback_presented'),
          event_count: perTrial.length,
        };
      });
    const auditRows = stmtListAudit.all(row.session_id) as { body: string }[];
    return {
      session,
      events,
      entry: JSON.parse(row.entry_json) as EntryAck,
      completed: row.completed === 1,
      presentation_audit: auditRows.map((record) => JSON.parse(record.body) as AuditRecordInput),
      feedback,
      feedbacks,
      trial_results: trialResults,
      reward_code: row.completed === 1 ? rewardCode(session.session_id) : null,
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

    // Validate before consent without creating a participant, cookie or experiment data.
    // Separate quota avoids consuming the admission allowance for a 50-person batch.
    if (method === 'POST' && pathname === '/api/entry/validate') {
      if (rateLimited(req.socket.remoteAddress ?? 'unknown', validationLimit)) {
        sendError(res, 429, 'RATE_LIMITED', '验证过于频繁，请稍后重试');
        return;
      }
      const body = (await readJson(req)) as { entry_code?: unknown } | null;
      if (typeof body?.entry_code !== 'string' || body.entry_code !== options.entryCode) {
        sendError(res, 403, 'INVALID_ENTRY_CODE', '参与码无效，请检查后重新输入。');
        return;
      }
      sendJson(res, 200, { valid: true });
      return;
    }

    if (method === 'POST' && pathname === '/api/session') {
      const existing = requireAuth(req);
      if (existing) {
        // Existing authenticated cookie resumes the session, preserving events.
        const liveSession = await loadLive(existing);
        sendJson(res, 200, snapshot(existing, liveSession));
        return;
      }
      if (rateLimited(req.socket.remoteAddress ?? 'unknown')) {
        sendError(res, 429, 'RATE_LIMITED', '会话创建过于频繁');
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
      const assignedConfig = activeConfig();
      const choices = assignedConfig?.config.conditions ?? [performanceReference];
      const assigned = choices[randomInt(choices.length)] ?? performanceReference;
      const privateSeed = randomBytes(32).toString('hex');
      const adapter = createOneTrialPreview({
        adviceForSelf: false,
        requireConsentVersion: entry.consent_version,
        requirePractice: practiceRequired,
        performanceReference: assigned,
        plan: assignedConfig?.config.plan ?? configuredPlan,
        privateSeed,
        seedSession: {
          configuration_revision: assignedConfig?.revision ?? 0,
          assignment_method: choices.length > 1 ? 'equal_random' : 'single',
          questionnaire_validation_version: '1.0.0',
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
        privateSeed,
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

    const trialId =
      new URL(req.url ?? '/', 'http://localhost').searchParams.get('trial_id') ?? PREVIEW_TRIAL_ID;
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
          trialId,
        );
        sendJson(res, 200, trial);
        return;
      }
      case 'GET /api/advice': {
        const liveSession = await loadLive(row);
        const advice = await liveSession.adapter.trialService.loadAdvice(
          liveSession.session,
          trialId,
        );
        stmtAdviceAccess.run(row.session_id, trialId);
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
          trialId,
        );
        stmtFeedbackAccess.run(row.session_id, trialId, JSON.stringify(feedback));
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
    const selected = query.get('session_ids')?.split(',');
    const rows = (stmtListSessions.all() as unknown as SessionRow[]).filter(
      (row) => !selected || selected.includes(row.session_id),
    );
    const shapes = await Promise.all(rows.map((row) => exportShape(row)));
    if (query.get('format') === 'csv') {
      const header = [
        'session_id',
        'participant_id',
        'participation_mode',
        'device_class',
        'recruitment_batch',
        'condition_id',
        'human_average_hit_rate',
        'ai_hit_rate',
        'ai_accuracy_tier',
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
        'practice_points',
        'total_points',
        'reward_per_point_cny',
        'calculated_reward_cny',
        'created_at',
        'source_choice',
        'confidence_percent',
        'advice_exposed',
        'advice_target_machine_id',
        'advice_correct',
        'independent_matches_advice',
        'final_matches_advice',
        'switched_to_advice',
        'trial_id',
        'block_id',
        'block_kind',
        'trial_index_in_block',
        'scores_excluded_from_formal',
        'plan_version',
        'configuration_revision',
        'assignment_method',
        'reward_code',
        'comprehension_error_count',
      ];
      const lines = [header.join(',')];
      for (const bundle of shapes) {
        const results = bundle.trial_results.length ? bundle.trial_results : [null];
        for (const trial of results) {
          const shape = {
            ...bundle,
            feedback: trial?.feedback ?? null,
            events: trial
              ? bundle.events.filter((e) => !e.trial_id || e.trial_id === trial.trial_id)
              : bundle.events,
          };
          const independent = shape.events.find((e) => e.event_type === 'prediction_submitted');
          const final = shape.events.find((e) => e.event_type === 'final_prediction_submitted');
          const source = shape.events.find((e) => e.event_type === 'source_selected');
          const confidence = shape.events.find((e) => e.event_type === 'confidence_submitted');
          const practice = shape.events.find((e) => e.event_type === 'practice_completed');
          const evaluation = shape.feedback?.advice_evaluation;
          const assigned = shape.session.condition_assignment ?? performanceReference;
          const practicePoints = bundle.session.experiment_plan
            ? bundle.trial_results
                .filter((t) => t.scores_excluded_from_formal)
                .reduce((n, t) => n + (t.feedback?.points_awarded ?? 0), 0)
            : practice?.event_type === 'practice_completed'
              ? practice.payload.total_points
              : 0;
          const mainPoints = bundle.trial_results
            .filter((t) => !t.scores_excluded_from_formal)
            .reduce((n, t) => n + (t.feedback?.points_awarded ?? 0), 0);
          const rewardPoints = bundle.session.experiment_plan
            ? mainPoints
            : practicePoints + mainPoints;
          const rewardRate =
            practice?.event_type === 'practice_completed'
              ? practice.payload.reward_per_point_cny
              : assigned.reward_per_point_cny;
          lines.push(
            [
              csvCell(shape.session.session_id),
              csvCell(shape.session.participant_id),
              csvCell(shape.session.metadata.participation_mode),
              csvCell(shape.session.metadata.device_class),
              csvCell(shape.session.recruitment_batch),
              csvCell(shape.session.group_assignment),
              csvCell(assigned.human_average_hit_rate),
              csvCell(assigned.ai_hit_rate),
              csvCell(assigned.ai_accuracy_tier),
              csvCell(shape.entry.consent_version),
              csvCell(shape.events.length),
              csvCell(shape.presentation_audit.length),
              csvCell(shape.completed),
              csvCell(
                independent ? (independent.payload as { machine_id?: string }).machine_id : '',
              ),
              csvCell(final ? (final.payload as { machine_id?: string }).machine_id : ''),
              csvCell(shape.feedback ? shape.feedback.actual_winner_machine_id : ''),
              csvCell(shape.feedback ? shape.feedback.independent_correct : ''),
              csvCell(shape.feedback ? shape.feedback.final_correct : ''),
              csvCell(shape.feedback ? shape.feedback.points_awarded : ''),
              csvCell(practicePoints),
              csvCell(rewardPoints),
              csvCell(rewardRate),
              csvCell(rewardRate === null ? '' : rewardPoints * rewardRate),
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
              csvCell(trial?.trial_id),
              csvCell(trial?.block_id),
              csvCell(trial?.block_kind),
              csvCell(trial?.trial_index_in_block),
              csvCell(trial?.scores_excluded_from_formal),
              csvCell(bundle.session.experiment_plan?.version),
              csvCell(bundle.session.configuration_revision),
              csvCell(bundle.session.assignment_method),
              csvCell(bundle.reward_code),
              csvCell(
                bundle.events.reduce(
                  (n, e) =>
                    n +
                    (e.event_type === 'questionnaire_block_submitted'
                      ? (e.payload.comprehension_errors ?? []).reduce(
                          (a, b) => a + b.incorrect_count,
                          0,
                        )
                      : 0),
                  0,
                ),
              ),
            ].join(','),
          );
        }
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
        if (pathname.startsWith('/api/admin/')) {
          await handleAdmin(req, res, pathname);
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
