// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ContractError,
  saveReceiptSchema,
  type EventEnvelope,
  type SaveReceipt,
  type Session,
} from '@contracts';
import {
  createRemoteAdapter as createAdapter,
  type RemoteAdapterOptions,
} from '../../src/adapters/http/remote-adapter.js';
import { SameIdRetryQueue, type StorageLike } from '../../src/persistence/retry-queue.js';

const SESSION: Session = {
  session_id: '11111111-1111-4111-8111-111111111111',
  participant_id: 'participant-1',
  recruitment_batch: 'pilot-2026-09',
  group_assignment: 'simulation',
  study_id: 'paper2-collect',
  protocol_version: 'unreleased',
  material_version: '0.3.0',
  contract_version: '0.3.0',
  adapter_version: '0.3.0',
  provider: 'collection-server',
  metadata: {
    participation_mode: 'on_site',
    device_class: 'desktop',
    recruitment_batch: 'pilot-2026-09',
    adapter_version: '0.3.0',
    provider: 'collection-server',
  },
};

function createRemoteAdapter(options: RemoteAdapterOptions) {
  return createAdapter({ ...options, queueSessionId: SESSION.session_id });
}

const SNAPSHOT = {
  session: SESSION,
  events: [],
  entry: { consent_version: 'collect-consent-2026-09-19-v1' },
  completed: false,
};

function receipt(ids: string[], status: 'in_progress' | 'completed' = 'in_progress'): SaveReceipt {
  return {
    acknowledged_event_ids: ids,
    rejected_events: [],
    unconfirmed_event_ids: [],
    persistence_scope: 'remote',
    session_status: status,
    persisted_at: new Date().toISOString(),
    receipt_id: `receipt-${ids.join('-') || 'empty'}`,
    current_phase: 'main',
  };
}

function envelope(sequence: number, eventId: string, type = 'confidence_submitted'): EventEnvelope {
  return {
    schema_version: '0.3.0',
    contract_version: '0.3.0',
    protocol_version: 'unreleased',
    material_version: '0.3.0',
    client_version: '0.3.0',
    session_id: SESSION.session_id,
    participant_id: SESSION.participant_id,
    event_id: eventId,
    sequence_no: sequence,
    trial_id: 'preview-trial-1',
    phase: 'main',
    event_type: type as EventEnvelope['event_type'],
    client_timestamp: new Date().toISOString(),
    elapsed_ms: 1,
    payload: type === 'confidence_submitted' ? { confidence_percent: 50 } : { source: 'ai' },
  } as EventEnvelope;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function memoryStorage(): StorageLike & { dump: Map<string, string> } {
  const dump = new Map<string, string>();
  return {
    dump,
    getItem: (k) => dump.get(k) ?? null,
    setItem: (k, v) => void dump.set(k, v),
    removeItem: (k) => void dump.delete(k),
  };
}

describe('remote HTTP adapter', () => {
  it('never clears pending events on a memory-only or incomplete acknowledgement', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '77777777-7777-4777-8777-777777777777');
    const adapter = createRemoteAdapter({
      storage,
      fetchImpl: async () =>
        jsonResponse({
          ...receipt([event.event_id]),
          persistence_scope: 'memory',
          receipt_id: null,
          persisted_at: null,
        }),
    });
    await expect(adapter.resultStore.saveEvents(SESSION, [event])).rejects.toMatchObject({
      code: 'PERSISTENCE_UNCONFIRMED',
    });
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event.event_id,
    );
    const incomplete = createRemoteAdapter({
      storage,
      fetchImpl: async () => jsonResponse(receipt([])),
    });
    await expect(incomplete.flushPending()).rejects.toMatchObject({
      code: 'PERSISTENCE_UNCONFIRMED',
    });
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event.event_id,
    );
  });

  it('a different session cannot flush another participant queue', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '88888888-8888-4888-8888-888888888888');
    const first = createRemoteAdapter({
      storage,
      maxAttempts: 1,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    await first.resultStore.saveEvents(SESSION, [event]).catch(() => undefined);
    let calls = 0;
    const other = createAdapter({
      storage,
      queueSessionId: 'other-session',
      fetchImpl: async () => {
        calls++;
        return jsonResponse(receipt([event.event_id]));
      },
    });
    await other.flushPending();
    expect(calls).toBe(0);
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event.event_id,
    );
  });
  it('queues events in sessionStorage before sending and returns the server receipt', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '22222222-2222-4222-8222-222222222222');
    const fetchImpl = async (input: unknown) =>
      String(input).endsWith('/api/session')
        ? jsonResponse(SNAPSHOT)
        : jsonResponse(receipt([event.event_id]));
    const adapter = createRemoteAdapter({ fetchImpl, storage, entry: SNAPSHOT.entry });
    await adapter.sessionService.openSession({
      entry_code: 'COLLECT-2026',
      observed_participation_mode: 'on_site',
      observed_device_class: 'desktop',
      client_versions: {
        protocol_version: 'unreleased',
        contract_version: '0.3.0',
        material_version: '0.3.0',
        client_version: '0.3.0',
      },
    });
    const result = await adapter.resultStore.saveEvents(SESSION, [event]);
    expect(saveReceiptSchema.parse(result)).toBeTruthy();
    expect(result.acknowledged_event_ids).toEqual([event.event_id]);
    expect(storage.dump.has(`paper2.collect.events.v1.${SESSION.session_id}`)).toBe(false);
  });

  it('retries the same payload on network failure (bounded) and keeps the queue on total failure', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '33333333-3333-4333-8333-333333333333');
    const bodies: string[] = [];
    let failures = 2;
    const fetchImpl = async (_input: unknown, init?: RequestInit) => {
      if (init?.body) bodies.push(String(init.body));
      if (failures > 0) {
        failures -= 1;
        throw new Error('socket reset');
      }
      return jsonResponse(receipt([event.event_id]));
    };
    const adapter = createRemoteAdapter({ fetchImpl, storage, maxAttempts: 3 });
    const ok = await adapter.resultStore.saveEvents(SESSION, [event]);
    expect(ok.acknowledged_event_ids).toEqual([event.event_id]);
    expect(bodies).toHaveLength(3);
    expect(new Set(bodies.map((b) => JSON.parse(b).events[0].event_id)).size).toBe(1);

    // Total failure: durable receipt is absent, record stays queued.
    const failing = createRemoteAdapter({
      storage,
      maxAttempts: 2,
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });
    const event2 = envelope(1, '44444444-4444-4444-8444-444444444444');
    await expect(failing.resultStore.saveEvents(SESSION, [event2])).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
    });
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event2.event_id,
    );

    // Reload resume: a fresh adapter over the same storage resends the SAME id.
    let seen: string | null = null;
    const resumed = createRemoteAdapter({
      storage,
      fetchImpl: async (_input: unknown, init?: RequestInit) => {
        seen = String(init?.body ?? '');
        return jsonResponse(receipt([event2.event_id]));
      },
    });
    await resumed.flushPending();
    expect(seen).toContain(event2.event_id);
    expect(storage.dump.has(`paper2.collect.events.v1.${SESSION.session_id}`)).toBe(false);
  });

  it('maps JSON /api errors to ContractError without retrying 4xx', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '55555555-5555-4555-8555-555555555555');
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse({ error: { code: 'INVALID_EVENT', message: '事件顺序或序号错误' } }, 422);
    };
    const adapter = createRemoteAdapter({ fetchImpl, storage, maxAttempts: 3 });
    const failure = await adapter.resultStore.saveEvents(SESSION, [event]).catch((e) => e);
    expect(failure).toBeInstanceOf(ContractError);
    expect(failure.code).toBe('INVALID_EVENT');
    expect(failure.retryable).toBe('no-retry');
    expect(calls).toBe(1);
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event.event_id,
    );
  });

  it('rejects schema-invalid receipts and hidden advice blocks', async () => {
    const storage = memoryStorage();
    const event = envelope(0, '66666666-6666-4666-8666-666666666666');
    const badReceipt = createRemoteAdapter({
      storage,
      fetchImpl: async () => jsonResponse({ acknowledged_event_ids: [event.event_id] }),
    });
    await expect(badReceipt.resultStore.saveEvents(SESSION, [event])).rejects.toThrow();
    expect(storage.dump.get(`paper2.collect.events.v1.${SESSION.session_id}`)).toContain(
      event.event_id,
    );

    const hiddenAdvice = createRemoteAdapter({
      storage: memoryStorage(),
      fetchImpl: async () => jsonResponse({ advice_id: 'a-1', revealed: false }),
    });
    await expect(
      hiddenAdvice.trialService.loadAdvice(SESSION, 'preview-trial-1'),
    ).rejects.toThrow();

    const unauthorized = createRemoteAdapter({
      storage: memoryStorage(),
      fetchImpl: async () =>
        jsonResponse({ error: { code: 'SESSION_EXPIRED', message: '无会话' } }, 401),
    });
    const failure = await unauthorized.snapshot().catch((e) => e);
    expect(failure).toBeInstanceOf(ContractError);
    expect(failure.code).toBe('SESSION_EXPIRED');
  });

  it('saveAudit removes only acknowledged ids and reports partial persistence', async () => {
    const storage = memoryStorage();
    const records = [
      { id: 'a1', type: 'opened', at_ms: 1, data: null },
      { id: 'a2', type: 'clicked', at_ms: 2, data: { x: 1 } },
    ];
    const fetchImpl = async (_input: unknown, _init?: RequestInit) =>
      jsonResponse({
        acknowledged_ids: ['a1'],
        persisted_at: new Date().toISOString(),
        receipt_id: 'audit-receipt-1',
      });
    const adapter = createRemoteAdapter({ fetchImpl, storage });
    await expect(adapter.saveAudit(records)).rejects.toMatchObject({
      code: 'PERSISTENCE_UNCONFIRMED',
    });
    const queued = storage.dump.get(`paper2.collect.audit.v1.${SESSION.session_id}`) ?? '';
    expect(queued).not.toContain('a1');
    expect(queued).toContain('a2');

    const second = createRemoteAdapter({
      storage,
      fetchImpl: async () =>
        jsonResponse({
          acknowledged_ids: ['a2'],
          persisted_at: new Date().toISOString(),
          receipt_id: 'audit-receipt-2',
        }),
    });
    await second.flushPending();
    expect(storage.dump.has(`paper2.collect.audit.v1.${SESSION.session_id}`)).toBe(false);
  });

  it('logout clears client queues without deleting server records', async () => {
    const storage = memoryStorage();
    // An unflushed audit record stays queued while offline.
    const offline = createRemoteAdapter({
      storage,
      fetchImpl: async (input: unknown) => {
        if (String(input).endsWith('/api/audit')) throw new Error('offline');
        return jsonResponse({ ok: true });
      },
    });
    await offline
      .saveAudit([{ id: 'audit-1', type: 'opened', at_ms: 1, data: null }])
      .catch(() => undefined);
    expect(storage.dump.has(`paper2.collect.audit.v1.${SESSION.session_id}`)).toBe(true);

    const adapter = createRemoteAdapter({
      storage,
      fetchImpl: async (input: unknown) =>
        String(input).endsWith('/api/logout')
          ? jsonResponse({ ok: true })
          : jsonResponse({ ok: true }),
    });
    await adapter.logout();
    expect(storage.dump.has(`paper2.collect.audit.v1.${SESSION.session_id}`)).toBe(false);
  });
});

describe('same-ID retry queue', () => {
  it('is idempotent for same id + same body and conflicts on changed content', () => {
    const queue = new SameIdRetryQueue<{ v: number }>(memoryStorage(), 'k');
    queue.enqueue('id-1', { v: 1 });
    queue.enqueue('id-1', { v: 1 });
    expect(queue.size).toBe(1);
    const conflict = (() => {
      try {
        queue.enqueue('id-1', { v: 2 });
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(conflict).toBeInstanceOf(ContractError);
    expect((conflict as ContractError).code).toBe('EVENT_CONFLICT');
    queue.remove(['id-1']);
    expect(queue.size).toBe(0);
  });

  it('is bounded and persists across reloads through injected storage', () => {
    const storage = memoryStorage();
    const first = new SameIdRetryQueue<number>(storage, 'bounded', 2);
    first.enqueue('a', 1);
    first.enqueue('b', 2);
    const full = (() => {
      try {
        first.enqueue('c', 3);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect(full).toBeInstanceOf(ContractError);
    expect((full as ContractError).code).toBe('PERSISTENCE_UNCONFIRMED');
    const reloaded = new SameIdRetryQueue<number>(storage, 'bounded', 2);
    expect(reloaded.pending().map((r) => r.id)).toEqual(['a', 'b']);
  });
});
