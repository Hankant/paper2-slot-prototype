// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ContractError,
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
import {
  ImmersiveRun,
  type AuditRecord,
  type RestoredSnapshot,
} from '../../src/experiment/immersive-run.js';

const TRIAL_ID = 'preview-trial-1';
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

const TRIAL: PublicTrial = {
  trial_id: TRIAL_ID,
  trial_index: 0,
  phase: 'main',
  visible_history: [
    { trial_id: 'history-demo', machine_id: 'A', observed_hit_rate: 0.7 },
    { trial_id: 'history-demo', machine_id: 'B', observed_hit_rate: 0.2 },
    { trial_id: 'history-demo', machine_id: 'C', observed_hit_rate: 0.1 },
  ],
  machines: [
    { machine_id: 'A', display_position: 'left', label: '机器 A' },
    { machine_id: 'B', display_position: 'center', label: '机器 B' },
    { machine_id: 'C', display_position: 'right', label: '机器 C' },
  ],
  advice_timing: 'after_choice',
  material_version: '0.3.0',
  advice: { advice_id: 'advice-1', revealed: false },
};

const ADVICE: RevealedAdviceBlock = {
  advice_id: 'advice-1',
  revealed: true,
  advice_target_machine_id: 'B',
  advice_target_display_position: 'center',
  copy: '模拟建议选择机器 B。',
};

function feedback(): TrialFeedback {
  return {
    trial_id: TRIAL_ID,
    actual_winner_machine_id: 'C',
    participant_predicted_winner: false,
    advice_target_hit: null,
    advice_actual_hit: false,
    points_awarded: 0,
    scoring_version: '0.3.1',
    independent_correct: false,
    final_correct: false,
    required_event_types: ['prediction_submitted', 'final_prediction_submitted'],
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** In-memory remote-like adapter: idempotent same-ID replay, conflict detect. */
function createStubAdapter() {
  const events: EventEnvelope[] = [];
  const byId = new Map<string, EventEnvelope>();
  const calls: { finish: number; audit: AuditRecord[][] } = { finish: 0, audit: [] };
  let finishStatus: SaveReceipt['session_status'] = 'completed';
  let serverCompleted = false;
  let failFirstFeedback = false;

  function receipt(ids: string[], status?: SaveReceipt['session_status']): SaveReceipt {
    return {
      acknowledged_event_ids: ids,
      rejected_events: [],
      unconfirmed_event_ids: [],
      persistence_scope: 'remote',
      session_status:
        status ?? (calls.finish > 0 && finishStatus === 'completed' ? 'completed' : 'in_progress'),
      persisted_at: new Date().toISOString(),
      receipt_id: `receipt-${ids.join('-') || 'none'}`,
      current_phase: 'main',
    };
  }

  const adapter: ExperimentAdapter = {
    sessionService: {
      async openSession(credential: EntryCredential) {
        if (credential.entry_code !== 'COLLECT-2026')
          throw new ContractError({
            code: 'INVALID_ENTRY_CODE',
            message: '参与码无效',
            retryable: 'no-retry',
          });
        return structuredClone(SESSION);
      },
      async loadState(): Promise<ExperimentState> {
        return {
          session_id: SESSION.session_id,
          phase: serverCompleted ? 'completed' : 'main',
          trial_index: 0,
          last_confirmed_event_id: events.at(-1)?.event_id ?? null,
          last_confirmed_sequence_no: events.at(-1)?.sequence_no ?? 0,
          // Completion follows the finish receipt, not the mere fact that
          // finish was called: 'awaiting_completion' must not mark completed.
          completed: serverCompleted,
          reconciliation_required: false,
        };
      },
      async finishSession(): Promise<SaveReceipt> {
        calls.finish += 1;
        if (finishStatus === 'completed') serverCompleted = true;
        return receipt([], finishStatus);
      },
      async describeCapabilities() {
        return {
          provider: 'stub',
          adapter_version: '0.3.0',
          capabilities: {
            persistentResults: 'supported',
            idempotentWrites: 'supported',
            resumeSession: 'supported',
            serverControlledTrials: 'supported',
            serverScoring: 'supported',
            individualEntryCodes: 'supported',
          },
        };
      },
    },
    trialService: {
      async loadTrial(): Promise<PublicTrial> {
        return structuredClone(TRIAL);
      },
      async loadAdvice(): Promise<RevealedAdviceBlock> {
        return { ...ADVICE };
      },
      async getFeedback(): Promise<TrialFeedback> {
        if (failFirstFeedback) {
          failFirstFeedback = false;
          throw new ContractError({
            code: 'NETWORK_UNAVAILABLE',
            message: 'offline',
            retryable: 'retry',
          });
        }
        return feedback();
      },
    },
    resultStore: {
      async saveEvents(
        _session: Session,
        incoming: ReadonlyArray<EventEnvelope>,
      ): Promise<SaveReceipt> {
        const acknowledged: string[] = [];
        for (const candidate of incoming) {
          const event = candidate as EventEnvelope;
          if (event.session_id !== SESSION.session_id)
            throw new ContractError({
              code: 'INVALID_EVENT',
              message: '身份不匹配',
              retryable: 'no-retry',
            });
          const previous = byId.get(event.event_id);
          if (previous) {
            if (canonical(previous) !== canonical(event))
              throw new ContractError({
                code: 'EVENT_CONFLICT',
                message: '同一事件 ID 内容变化',
                retryable: 'no-retry',
              });
          } else {
            byId.set(event.event_id, structuredClone(event));
            events.push(structuredClone(event));
          }
          acknowledged.push(event.event_id);
        }
        return receipt(acknowledged);
      },
    },
  };
  return {
    adapter,
    events,
    calls,
    snapshot(): RestoredSnapshot {
      return { session: structuredClone(SESSION), events: structuredClone(events) };
    },
    setFinishStatus(status: SaveReceipt['session_status']) {
      finishStatus = status;
    },
    failNextFeedback() {
      failFirstFeedback = true;
    },
  };
}

const CREDENTIAL: EntryCredential = {
  entry_code: 'COLLECT-2026',
  observed_participation_mode: 'on_site',
  observed_device_class: 'desktop',
  client_versions: {
    protocol_version: 'unreleased',
    contract_version: '0.3.0',
    material_version: '0.3.0',
    client_version: '0.3.0',
  },
};

async function freshRun(stub: ReturnType<typeof createStubAdapter>) {
  return new ImmersiveRun(stub.adapter, TRIAL_ID, { credential: CREDENTIAL });
}

describe('collection restore and receipt gating', () => {
  it('restores a session locked through the source stage and blocks re-prediction', async () => {
    const stub = createStubAdapter();
    const first = await freshRun(stub);
    await first.initialize({
      version: 'collect-consent-2026-09-19-v1',
      acceptedAt: new Date().toISOString(),
    });
    await first.predict('A', 70);

    const resumed = new ImmersiveRun(stub.adapter, TRIAL_ID, {
      credential: CREDENTIAL,
      snapshot: stub.snapshot(),
    });
    await resumed.initialize({
      version: 'collect-consent-2026-09-19-v1',
      acceptedAt: new Date().toISOString(),
    });
    expect(resumed.restored).toBe(true);
    expect(resumed.stage).toBe('source');
    expect(resumed.independent).toBe('A');
    expect(resumed.confidence).toBe(70);
    // No duplicate consent or prediction events were written during resume.
    expect(stub.events.filter((e) => e.event_type === 'consent_recorded')).toHaveLength(1);
    expect(stub.events.filter((e) => e.event_type === 'prediction_submitted')).toHaveLength(1);
    await expect(resumed.predict('B', 30)).rejects.toThrow('独立预测已经锁定');
    await resumed.chooseSource('human');
    expect(resumed.stage).toBe('final');
  });

  it('partial prediction without confidence retries the SAME original choice, never overwriting', async () => {
    const stub = createStubAdapter();
    const first = await freshRun(stub);
    await first.initialize();
    // Simulate an interrupted save: prediction confirmed, confidence lost.
    await first.predict('A', 70);
    const base = stub.snapshot();
    const snapshot: RestoredSnapshot = {
      ...base,
      events: base.events.filter((e) => e.event_type !== 'confidence_submitted'),
    };
    // The interrupted-save simulation must drop the record from the durable
    // store as well; filtering only the client snapshot would leave the
    // confirmed original server-side and force a duplicate confidence event.
    const durableIndex = stub.events.findIndex((e) => e.event_type === 'confidence_submitted');
    if (durableIndex >= 0) stub.events.splice(durableIndex, 1);

    const resumed = new ImmersiveRun(stub.adapter, TRIAL_ID, { credential: CREDENTIAL, snapshot });
    await resumed.initialize();
    expect(resumed.stage).toBe('prediction');
    expect(resumed.independent).toBe('A');
    await resumed.predict('B', 90); // user picks another machine
    expect(resumed.independent).toBe('A'); // locked original choice retried
    const predictions = stub.events.filter((e) => e.event_type === 'prediction_submitted');
    expect(predictions).toHaveLength(1);
    const confidences = stub.events.filter((e) => e.event_type === 'confidence_submitted');
    expect(confidences).toHaveLength(1);
    expect(confidences[0]?.sequence_no).toBe(predictions[0]!.sequence_no + 1);
    expect(resumed.stage).toBe('source');
  });

  it('restored final-submitted goes ready and finishes without duplicating events', async () => {
    const stub = createStubAdapter();
    const first = await freshRun(stub);
    await first.initialize();
    await first.predict('A', 60);
    await first.chooseSource('human');
    await first.confirmFinal('C');
    const count = stub.events.length;

    const resumed = new ImmersiveRun(stub.adapter, TRIAL_ID, {
      credential: CREDENTIAL,
      snapshot: stub.snapshot(),
    });
    await resumed.initialize();
    expect(resumed.stage).toBe('ready');
    expect(resumed.final).toBe('C');
    const result = await resumed.startDraw();
    expect(result.actual_winner_machine_id).toBe('C');
    await resumed.presentFeedback(result);
    expect(stub.calls.finish).toBe(1);
    expect(stub.events.length).toBe(count + 2); // feedback_presented + completion only
    expect((await stub.adapter.sessionService.loadState(SESSION)).completed).toBe(true);
  });

  it('restored feedback-presented finishes pending completion safely after a failed finish', async () => {
    const stub = createStubAdapter();
    const first = await freshRun(stub);
    await first.initialize();
    await first.predict('A', 60);
    await first.chooseSource('human');
    await first.confirmFinal('C');
    const result = await first.startDraw();
    await first.presentFeedback(result);
    expect(stub.calls.finish).toBe(1);
    const count = stub.events.length;

    // Reload AFTER everything persisted: session already completed server-side.
    const resumed = new ImmersiveRun(stub.adapter, TRIAL_ID, {
      credential: CREDENTIAL,
      snapshot: { ...stub.snapshot(), completed: true },
    });
    await resumed.initialize();
    expect(resumed.stage).toBe('feedback');
    expect(resumed.completed).toBe(true);
    const again = await resumed.resumeFeedback();
    await resumed.presentFeedback(again); // idempotent: no dup, no extra finish problem
    expect(stub.events.length).toBe(count);
    expect(stub.calls.finish).toBe(2); // pending completion was finished safely
  });

  it('receipt gating: no completion when finish lacks a durable completed receipt', async () => {
    const stub = createStubAdapter();
    stub.setFinishStatus('awaiting_completion');
    const order: string[] = [];
    const run = new ImmersiveRun(stub.adapter, TRIAL_ID, {
      credential: CREDENTIAL,
      flushAudit: async (records) => {
        order.push(`audit:${records.length}`);
      },
    });
    await run.initialize();
    await run.predict('A', 55);
    await run.chooseSource('human');
    await run.confirmFinal('C');
    const result = await run.startDraw();
    const originalFinish = stub.adapter.sessionService.finishSession.bind(
      stub.adapter.sessionService,
    );
    stub.adapter.sessionService.finishSession = async (s) => {
      order.push('finish');
      return originalFinish(s);
    };
    await expect(run.presentFeedback(result)).rejects.toThrow('本轮尚未确认完成');
    expect(run.completed).toBe(false);
    expect(order[0]).toMatch(/^audit:/); // audit flushed BEFORE finish
    expect(order[1]).toBe('finish');
    expect((await stub.adapter.sessionService.loadState(SESSION)).completed).toBe(false);
  });

  it('audit records get stable ids; restoreAudit re-adopts delivered records once', async () => {
    const stub = createStubAdapter();
    const run = await freshRun(stub);
    await run.initialize();
    run.note('visibility_changed', 'hidden');
    run.note('visibility_changed', 'visible');
    const ids = run.audit.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(run.audit[0]).toMatchObject({ type: 'opened' });

    const delivered: AuditRecord[] = run.audit.map((r) => ({ ...r }));
    const other = await freshRun(stub);
    await other.initialize();
    // A reload is a new presentation; previous records retain their original IDs.
    expect(other.restoreAudit(delivered)).toBe(delivered.length);
    expect(other.restoreAudit(delivered)).toBe(0); // dedupe by id
    expect(other.audit.length).toBe(run.audit.length + 1);
  });
});
