/**
 * Remote HTTP adapter for the collection pilot (see .agents/architecture.md).
 *
 * Implements the frozen same-origin JSON API:
 *   POST /api/session, GET /api/session, GET /api/trial, GET /api/advice,
 *   GET /api/feedback, POST /api/events, POST /api/audit, POST /api/finish,
 *   GET /api/export, POST /api/logout
 *
 * Guarantees:
 *   - fetch is same-origin with credentials; bounded retries reuse the exact
 *     same payload (same event IDs, same bodies);
 *   - every unknown response is schema-validated before use;
 *   - events and audit records are queued in sessionStorage BEFORE sending
 *     and removed only on explicit acknowledgement, so a reload retries the
 *     same IDs against the idempotent server;
 *   - nothing is ever described as saved/completed without a server receipt.
 */

import {
  ContractError,
  ERROR_CODES,
  parseEventEnvelope,
  publicTrialSchema,
  revealedAdviceBlockSchema,
  saveReceiptSchema,
  sessionSchema,
  trialFeedbackSchema,
  type Capabilities,
  type EntryCredential,
  type EventEnvelope,
  type ExperimentAdapter,
  type ExperimentState,
  type PublicTrial,
  type RevealedAdviceBlock,
  type SaveReceipt,
  type Session,
  type TrialFeedback,
} from '@contracts';
import { SameIdRetryQueue, type StorageLike } from '../../persistence/retry-queue.js';

export interface AuditRecord {
  readonly id: string;
  readonly type: string;
  readonly at_ms: number;
  readonly data: unknown;
}

export interface AuditAck {
  readonly acknowledged_ids: string[];
  readonly persisted_at: string;
  readonly receipt_id: string;
}

/** GET /api/session -> Snapshot. Never includes future result/advice. */
export interface RemoteSnapshot {
  readonly session: Session;
  readonly events: EventEnvelope[];
  readonly entry: unknown;
  readonly completed: boolean;
}

/** GET /api/export -> own-session bundle. */
export interface RemoteExport {
  readonly simulation: boolean;
  readonly persistence_scope: 'remote';
  readonly session: Session;
  readonly events: EventEnvelope[];
  readonly entry: unknown;
  readonly presentation_audit: AuditRecord[];
  readonly feedback: TrialFeedback | null;
}

export interface RemoteAdapterOptions {
  /** Same-origin default; override only for tests. */
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Bounded retry count per request (network/5xx only). */
  readonly maxAttempts?: number;
  /** Defaults to window.sessionStorage in the browser; null disables queueing. */
  readonly storage?: StorageLike | null;
  /** Entry acknowledgement forwarded to POST /api/session. */
  readonly entry?: unknown;
  readonly queueSessionId?: string;
}

export type RemoteAdapter = ExperimentAdapter & {
  snapshot(): Promise<RemoteSnapshot>;
  export(): Promise<RemoteExport>;
  saveAudit(records: ReadonlyArray<AuditRecord>): Promise<AuditAck>;
  queueAudit(record: AuditRecord): void;
  logout(): Promise<void>;
  /** Retry everything still queued (used after a reload resumes a session). */
  flushPending(): Promise<void>;
};

const EVENT_QUEUE_KEY = 'paper2.collect.events.v1';
const AUDIT_QUEUE_KEY = 'paper2.collect.audit.v1';

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function isErrorCode(value: unknown): value is (typeof ERROR_CODES)[number] {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

function toContractError(status: number, payload: unknown): ContractError {
  const body =
    typeof payload === 'object' && payload !== null
      ? (payload as { error?: unknown }).error
      : undefined;
  const code =
    typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  const message =
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { message?: unknown }).message === 'string'
      ? ((body as { message: string }).message ?? '请求被拒绝')
      : `请求失败（HTTP ${status}）`;
  const mapped =
    status === 401 ? 'SESSION_EXPIRED' : isErrorCode(code) ? code : 'PERSISTENCE_UNCONFIRMED';
  return new ContractError({
    code: mapped,
    message,
    retryable: status >= 500 || status === 429 || status === 408 ? 'retry' : 'no-retry',
  });
}

function parseAuditRecord(value: unknown): AuditRecord {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as AuditRecord).id !== 'string' ||
    typeof (value as AuditRecord).type !== 'string' ||
    typeof (value as AuditRecord).at_ms !== 'number'
  ) {
    throw new ContractError({
      code: 'INVALID_EVENT',
      message: '审计记录缺少 id/type/at_ms 字段',
      retryable: 'no-retry',
    });
  }
  return value as AuditRecord;
}

function parseSnapshot(payload: unknown): RemoteSnapshot {
  if (typeof payload !== 'object' || payload === null) {
    throw new ContractError({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: '会话快照格式无效',
      retryable: 'no-retry',
    });
  }
  const raw = payload as {
    session?: unknown;
    events?: unknown;
    entry?: unknown;
    completed?: unknown;
  };
  const session = sessionSchema.parse(raw.session) as Session;
  if (!Array.isArray(raw.events)) {
    throw new ContractError({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: '会话快照事件列表无效',
      retryable: 'no-retry',
    });
  }
  const events = raw.events.map((e) => parseEventEnvelope(e));
  if (typeof raw.completed !== 'boolean') {
    throw new ContractError({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: '会话快照完成标记无效',
      retryable: 'no-retry',
    });
  }
  return { session, events, entry: raw.entry ?? null, completed: raw.completed };
}

function parseExport(payload: unknown): RemoteExport {
  if (typeof payload !== 'object' || payload === null) {
    throw new ContractError({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: '导出内容格式无效',
      retryable: 'no-retry',
    });
  }
  const raw = payload as Record<string, unknown>;
  const audit = Array.isArray(raw.presentation_audit) ? raw.presentation_audit : null;
  if (
    raw.simulation !== true ||
    raw.persistence_scope !== 'remote' ||
    audit === null ||
    typeof raw.feedback === 'undefined'
  ) {
    throw new ContractError({
      code: 'PERSISTENCE_UNCONFIRMED',
      message: '导出内容字段不完整',
      retryable: 'no-retry',
    });
  }
  return {
    simulation: true,
    persistence_scope: 'remote',
    session: sessionSchema.parse(raw.session) as Session,
    events: Array.isArray(raw.events) ? raw.events.map((e) => parseEventEnvelope(e)) : [],
    entry: raw.entry ?? null,
    presentation_audit: audit.map(parseAuditRecord),
    feedback:
      raw.feedback === null ? null : (trialFeedbackSchema.parse(raw.feedback) as TrialFeedback),
  };
}

export function createRemoteAdapter(options: RemoteAdapterOptions = {}): RemoteAdapter {
  const baseUrl = options.baseUrl ?? '';
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  let boundSession = options.queueSessionId ?? '';
  let eventQueue = new SameIdRetryQueue<EventEnvelope>(
    storage,
    `${EVENT_QUEUE_KEY}.${boundSession}`,
  );
  let auditQueue = new SameIdRetryQueue<AuditRecord>(storage, `${AUDIT_QUEUE_KEY}.${boundSession}`);
  function bindSession(id: string): void {
    if (boundSession === id) return;
    boundSession = id;
    eventQueue = new SameIdRetryQueue<EventEnvelope>(storage, `${EVENT_QUEUE_KEY}.${id}`);
    auditQueue = new SameIdRetryQueue<AuditRecord>(storage, `${AUDIT_QUEUE_KEY}.${id}`);
  }
  function durable(receipt: SaveReceipt): SaveReceipt {
    if (receipt.persistence_scope !== 'remote' || !receipt.receipt_id || !receipt.persisted_at)
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '缺少服务器持久化回执',
        retryable: 'retry',
      });
    return receipt;
  }

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    let lastError: ContractError | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}${path}`, {
          method,
          credentials: 'same-origin',
          headers: body === undefined ? undefined : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        let payload: unknown = null;
        if (text) payload = JSON.parse(text);
        if (!response.ok) throw toContractError(response.status, payload);
        return payload;
      } catch (error) {
        const contract =
          error instanceof ContractError
            ? error
            : new ContractError({
                code: 'NETWORK_UNAVAILABLE',
                message:
                  error instanceof Error && error.name === 'AbortError'
                    ? '请求超时，请检查网络'
                    : '网络不可用，记录已保留，可重试',
                retryable: 'retry',
              });
        lastError = contract;
        if (contract.retryable !== 'retry') throw contract;
      } finally {
        clearTimeout(timer);
      }
    }
    throw (
      lastError ??
      new ContractError({ code: 'NETWORK_UNAVAILABLE', message: '网络不可用', retryable: 'retry' })
    );
  }

  async function flushEvents(): Promise<SaveReceipt | null> {
    const pending = eventQueue.pending();
    if (pending.length === 0) return null;
    const receipt = durable(
      saveReceiptSchema.parse(
        await request('POST', '/api/events', { events: pending.map((r) => r.body) }),
      ) as SaveReceipt,
    );
    eventQueue.remove(receipt.acknowledged_event_ids);
    const rejected = receipt.rejected_events[0];
    if (rejected) {
      throw new ContractError({
        code: isErrorCode(rejected.reason_code) ? rejected.reason_code : 'INVALID_EVENT',
        message: rejected.reason_message,
        retryable: 'no-retry',
      });
    }
    if (pending.some((record) => !receipt.acknowledged_event_ids.includes(record.id))) {
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '部分作答尚未获得确认',
        retryable: 'retry',
      });
    }
    return receipt;
  }

  async function flushAuditRecords(): Promise<AuditAck> {
    const pending = auditQueue.pending();
    if (pending.length === 0)
      return {
        acknowledged_ids: [],
        persisted_at: new Date().toISOString(),
        receipt_id: 'audit-empty',
      };
    const payload = await request('POST', '/api/audit', { records: pending.map((r) => r.body) });
    const raw = payload as {
      acknowledged_ids?: unknown;
      persisted_at?: unknown;
      receipt_id?: unknown;
    };
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !Array.isArray(raw.acknowledged_ids) ||
      raw.acknowledged_ids.some((id) => typeof id !== 'string') ||
      typeof raw.persisted_at !== 'string' ||
      typeof raw.receipt_id !== 'string'
    ) {
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '审计回执格式无效',
        retryable: 'no-retry',
      });
    }
    const ack: AuditAck = {
      acknowledged_ids: raw.acknowledged_ids as string[],
      persisted_at: raw.persisted_at,
      receipt_id: raw.receipt_id,
    };
    if (!ack.receipt_id || !ack.persisted_at) {
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '审计记录缺少持久化回执',
        retryable: 'retry',
      });
    }
    auditQueue.remove(ack.acknowledged_ids);
    if (pending.some((record) => !ack.acknowledged_ids.includes(record.id))) {
      throw new ContractError({
        code: 'PERSISTENCE_UNCONFIRMED',
        message: '部分审计记录未获确认',
        retryable: 'retry',
      });
    }
    return ack;
  }

  let lastSnapshot: RemoteSnapshot | null = null;

  const adapter: RemoteAdapter = {
    async snapshot() {
      lastSnapshot = parseSnapshot(await request('GET', '/api/session'));
      bindSession(lastSnapshot.session.session_id);
      return lastSnapshot;
    },

    async export() {
      return parseExport(await request('GET', '/api/export'));
    },

    async saveAudit(records) {
      const validated = records.map(parseAuditRecord);
      for (const record of validated) auditQueue.enqueue(record.id, record);
      return flushAuditRecords();
    },

    queueAudit(record) {
      if (!boundSession) throw new Error('尚未建立会话，不能记录呈现事件');
      auditQueue.enqueue(record.id, parseAuditRecord(record));
    },

    async logout() {
      const payload = await request('POST', '/api/logout', {});
      if (
        typeof payload !== 'object' ||
        payload === null ||
        (payload as { ok?: unknown }).ok !== true
      ) {
        throw new ContractError({
          code: 'PERSISTENCE_UNCONFIRMED',
          message: '退出回执格式无效',
          retryable: 'no-retry',
        });
      }
      // Clears the cookie server-side and the client-side queues; records on
      // the server are never deleted by logout.
      eventQueue.clear();
      auditQueue.clear();
    },

    async flushPending() {
      await flushEvents();
      await flushAuditRecords();
    },

    sessionService: {
      async openSession(credential: EntryCredential): Promise<Session> {
        const payload = await request('POST', '/api/session', {
          credential,
          ...(options.entry === undefined ? {} : { entry: options.entry }),
        });
        const snapshot = parseSnapshot(payload);
        lastSnapshot = snapshot;
        bindSession(snapshot.session.session_id);
        return snapshot.session;
      },

      async loadState(session: Session): Promise<ExperimentState> {
        const snapshot =
          lastSnapshot?.session.session_id === session.session_id
            ? lastSnapshot
            : parseSnapshot(await request('GET', '/api/session'));
        const last = snapshot.events.at(-1);
        return {
          session_id: session.session_id,
          phase: snapshot.completed ? 'completed' : snapshot.events.length > 0 ? 'main' : 'consent',
          trial_index: 0,
          last_confirmed_event_id: last?.event_id ?? null,
          last_confirmed_sequence_no: last?.sequence_no ?? 0,
          completed: snapshot.completed,
          reconciliation_required: false,
        };
      },

      async finishSession(session: Session): Promise<SaveReceipt> {
        void session;
        await adapter.flushPending();
        return durable(
          saveReceiptSchema.parse(await request('POST', '/api/finish', {})) as SaveReceipt,
        );
      },

      async describeCapabilities(): Promise<Capabilities> {
        return {
          provider: 'collection-server',
          adapter_version: '0.3.0',
          capabilities: {
            persistentResults: 'supported',
            idempotentWrites: 'supported',
            resumeSession: 'supported',
            serverControlledTrials: 'supported',
            serverScoring: 'supported',
            individualEntryCodes: 'unsupported',
          },
        };
      },
    },

    trialService: {
      async loadTrial(session: Session, trialId: string): Promise<PublicTrial> {
        void session;
        void trialId;
        return publicTrialSchema.parse(await request('GET', '/api/trial')) as PublicTrial;
      },

      async loadAdvice(session: Session, trialId: string): Promise<RevealedAdviceBlock> {
        void session;
        void trialId;
        // A hidden (not-yet-revealed) block fails this strict schema, which is
        // exactly the gating the UI relies on.
        return revealedAdviceBlockSchema.parse(
          await request('GET', '/api/advice'),
        ) as RevealedAdviceBlock;
      },

      async getFeedback(session: Session, trialId: string): Promise<TrialFeedback> {
        void session;
        void trialId;
        return trialFeedbackSchema.parse(await request('GET', '/api/feedback')) as TrialFeedback;
      },
    },

    resultStore: {
      async saveEvents(
        session: Session,
        events: ReadonlyArray<EventEnvelope>,
      ): Promise<SaveReceipt> {
        bindSession(session.session_id);
        const envelopes = events.map((e) => parseEventEnvelope(e));
        for (const envelope of envelopes) {
          if (envelope.session_id !== session.session_id) {
            throw new ContractError({
              code: 'INVALID_EVENT',
              message: '事件身份与当前会话不一致',
              retryable: 'no-retry',
            });
          }
          eventQueue.enqueue(envelope.event_id, envelope);
        }
        const receipt = await flushEvents();
        if (!receipt) {
          throw new ContractError({
            code: 'PERSISTENCE_UNCONFIRMED',
            message: '保存未获服务器回执',
            retryable: 'retry',
          });
        }
        return receipt;
      },
    },
  };
  return adapter;
}
