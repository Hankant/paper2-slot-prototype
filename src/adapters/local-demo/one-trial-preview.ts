/** One deterministic, memory-only preview. Answers are in the browser: NEVER use for recruitment. */
import {
  CONTRACT_VERSION,
  SCHEMA_VERSION,
  CLIENT_VERSION,
  ContractError,
  parseEventEnvelope,
  type EventEnvelope,
  type ExperimentAdapter,
  type ExperimentEventType,
  type PublicTrial,
  type PerformanceReference,
  type RevealedAdviceBlock,
  type SaveReceipt,
  type Session,
  type TrialFeedback,
} from '@contracts';
import { evaluateAdvice } from '../../domain/advice-evaluation.js';
import { randomId } from '../../uuid.js';

export const PREVIEW_TRIAL_ID = 'preview-trial-1';
const machines = [
  { machine_id: 'A', display_position: 'left', label: '机器 A' },
  { machine_id: 'B', display_position: 'center', label: '机器 B' },
  { machine_id: 'C', display_position: 'right', label: '机器 C' },
] as const;
const advice: RevealedAdviceBlock = {
  advice_id: 'preview-advice-1',
  revealed: true,
  advice_target_machine_id: 'B',
  advice_target_display_position: 'center',
  copy: '综合本轮信息，我建议选择机器 B。建议仅供参考，请由你确认最终预测。',
};
const DEFAULT_PERFORMANCE_REFERENCE: PerformanceReference = {
  condition_id: 'human-55_ai-plus5',
  human_average_hit_rate: 0.55,
  ai_hit_rate: 0.6,
  ai_accuracy_tier: 'plus_5pp',
  points_per_correct: 10,
  reward_per_point_cny: null,
};
const required: ExperimentEventType[] = [
  'prediction_submitted',
  'confidence_submitted',
  'source_selected',
  'advice_revealed',
  'final_prediction_submitted',
];
const order: ExperimentEventType[] = [
  ...required,
  'feedback_presented',
  'session_completion_requested',
];

function fail(message: string, code: 'OUT_OF_ORDER' | 'INVALID_EVENT' = 'OUT_OF_ORDER'): never {
  throw new ContractError({ code, message, retryable: 'no-retry' });
}

/** Compare JSON content independent of object key insertion order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function createOneTrialPreview(
  options: {
    adviceForSelf?: boolean;
    requireConsentVersion?: string;
    requirePractice?: boolean;
    performanceReference?: PerformanceReference;
    /** Server-only: pin identity/metadata so a durable backend can replay
     *  the exact session after a restart. Omit for the browser preview. */
    seedSession?: Partial<Session>;
  } = {},
): ExperimentAdapter & { exportEvents(): EventEnvelope[] } {
  const seed = options.seedSession ?? {};
  const performanceReference =
    seed.condition_assignment ?? options.performanceReference ?? DEFAULT_PERFORMANCE_REFERENCE;
  const defaults: Session = {
    session_id: randomId(),
    participant_id: 'virtual-preview',
    recruitment_batch: 'preview',
    group_assignment: performanceReference.condition_id,
    study_id: 'one-trial-preview',
    protocol_version: 'unreleased',
    material_version: '0.3.0',
    contract_version: CONTRACT_VERSION,
    adapter_version: '0.3.0',
    provider: 'memory-preview',
    condition_assignment: performanceReference,
    metadata: {
      participation_mode: 'unknown',
      device_class: 'unknown',
      recruitment_batch: 'preview',
      adapter_version: '0.3.0',
      provider: 'memory-preview',
    },
  };
  const session: Session = {
    ...defaults,
    ...seed,
    metadata: { ...defaults.metadata, ...(seed.metadata ?? {}) },
  };
  const events: EventEnvelope[] = [];
  const byId = new Map<string, EventEnvelope>();
  const entryRequired: ExperimentEventType[] = options.requireConsentVersion
    ? ['consent_recorded']
    : [];
  if (options.requirePractice) entryRequired.push('practice_completed');
  let opened = false;
  let completed = false;
  let adviceLoaded = false;
  let feedbackLoaded = false;
  let feedback: TrialFeedback | undefined;

  function checkSession(input: Session): void {
    if (
      !opened ||
      input.session_id !== session.session_id ||
      input.participant_id !== session.participant_id
    ) {
      fail('未知预览会话', 'INVALID_EVENT');
    }
  }
  function checkTrial(input: Session, trialId: string): void {
    checkSession(input);
    if (options.requireConsentVersion && !has('consent_recorded')) fail('请先确认参与说明');
    if (trialId !== PREVIEW_TRIAL_ID) fail('未知试次', 'INVALID_EVENT');
  }
  function has(type: ExperimentEventType): boolean {
    return events.some((e) => e.event_type === type);
  }
  function selfWithoutAdvice(): boolean {
    return (
      options.adviceForSelf === false &&
      events.some((e) => e.event_type === 'source_selected' && e.payload.source === 'human')
    );
  }
  function receipt(ids: string[] = []): SaveReceipt {
    return {
      acknowledged_event_ids: ids,
      rejected_events: [],
      unconfirmed_event_ids: [],
      persistence_scope: 'memory',
      session_status: completed ? 'completed' : 'in_progress',
      persisted_at: null,
      receipt_id: null,
      current_phase: completed
        ? 'completed'
        : options.requireConsentVersion && !has('consent_recorded')
          ? 'consent'
          : options.requirePractice && !has('practice_completed')
            ? 'practice'
            : 'main',
    };
  }
  function checkEvent(event: EventEnvelope): void {
    if (completed || event.sequence_no !== events.length) {
      fail('事件顺序或序号错误');
    }
    const existingQuestionnaires = events.filter(
      (saved) => saved.event_type === 'questionnaire_block_submitted',
    );
    if (event.event_type === 'questionnaire_block_submitted') {
      if (
        existingQuestionnaires.some(
          (saved) =>
            saved.event_type === 'questionnaire_block_submitted' &&
            saved.payload.block_id === event.payload.block_id,
        )
      )
        fail('问卷区块重复', 'INVALID_EVENT');
      if (event.payload.position === 'pre') {
        if (has('prediction_submitted')) fail('前测必须在主任务前完成');
        if (options.requireConsentVersion && !has('consent_recorded')) fail('请先确认参与说明');
      } else if (!has('feedback_presented') || has('session_completion_requested')) {
        fail('后测必须在结果呈现后、完成请求前提交');
      }
    } else {
      const coreEvents = events.filter(
        (saved) => saved.event_type !== 'questionnaire_block_submitted',
      );
      const expected = [...entryRequired, ...order].filter(
        (type) => !(selfWithoutAdvice() && type === 'advice_revealed'),
      )[coreEvents.length];
      if (expected !== event.event_type) fail('事件顺序或序号错误');
    }
    const expectedPhase =
      event.event_type === 'consent_recorded'
        ? 'consent'
        : event.event_type === 'practice_completed'
          ? 'practice'
          : event.event_type === 'questionnaire_block_submitted'
            ? event.payload.position === 'pre'
              ? 'profile'
              : 'finalizing'
            : 'main';
    if (event.phase !== expectedPhase) fail('事件阶段不匹配', 'INVALID_EVENT');
    if (
      event.event_type === 'consent_recorded' &&
      event.payload.version !== options.requireConsentVersion
    )
      fail('参与说明版本不匹配', 'INVALID_EVENT');
    if (event.event_type === 'practice_completed') {
      const expected = performanceReference;
      if (
        event.payload.condition_id !== expected.condition_id ||
        event.payload.human_average_hit_rate !== expected.human_average_hit_rate ||
        event.payload.ai_hit_rate !== expected.ai_hit_rate ||
        event.payload.ai_accuracy_tier !== expected.ai_accuracy_tier ||
        event.payload.points_per_correct !== expected.points_per_correct ||
        event.payload.reward_per_point_cny !== expected.reward_per_point_cny
      )
        fail('试玩条件与后台分配不一致', 'INVALID_EVENT');
      const recomputed = event.payload.trials.reduce(
        (sum, trial) => sum + (trial.correct ? expected.points_per_correct : 0),
        0,
      );
      if (
        event.payload.total_points !== recomputed ||
        event.payload.trials.some(
          (trial) =>
            trial.correct !== (trial.predicted_machine_id === trial.actual_winner_machine_id) ||
            trial.points_awarded !== (trial.correct ? expected.points_per_correct : 0),
        )
      )
        fail('试玩计分不一致', 'INVALID_EVENT');
    }
    if (event.trial_id !== undefined && event.trial_id !== PREVIEW_TRIAL_ID)
      fail('试次不匹配', 'INVALID_EVENT');
    if (
      event.schema_version !== SCHEMA_VERSION ||
      event.contract_version !== CONTRACT_VERSION ||
      event.client_version !== CLIENT_VERSION ||
      event.material_version !== session.material_version ||
      event.protocol_version !== session.protocol_version
    )
      fail('版本不匹配', 'INVALID_EVENT');
    if (
      event.event_type === 'prediction_submitted' ||
      event.event_type === 'final_prediction_submitted'
    ) {
      if (
        !machines.some(
          (m) =>
            m.machine_id === event.payload.machine_id &&
            m.display_position === event.payload.display_position,
        )
      ) {
        fail('机器与屏幕位置不匹配', 'INVALID_EVENT');
      }
    }
    if (event.event_type === 'source_selected' && !['human', 'ai'].includes(event.payload.source)) {
      fail('此预览仅支持自己或 AI', 'INVALID_EVENT');
    }
    if (
      event.event_type === 'advice_revealed' &&
      (!adviceLoaded ||
        event.payload.advice_id !== advice.advice_id ||
        event.payload.revealed_at_phase !== 'main')
    )
      fail('建议尚不可展示');
    if (event.event_type === 'final_prediction_submitted') {
      const independent = events.find((e) => e.event_type === 'prediction_submitted');
      if (
        !independent ||
        event.payload.changed_after_advice !==
          (independent.payload.machine_id !== event.payload.machine_id)
      ) {
        fail('答案变化标记不一致', 'INVALID_EVENT');
      }
    }
    if (event.event_type === 'feedback_presented' && !feedbackLoaded) fail('尚未读取反馈');
    if (
      event.event_type === 'session_completion_requested' &&
      event.payload.ack_required_event_count !== events.length
    ) {
      fail('完成请求的确认数不一致', 'INVALID_EVENT');
    }
  }

  return {
    exportEvents: () => structuredClone(events),
    sessionService: {
      async openSession(credential) {
        if (credential.entry_code !== 'PREVIEW-ONLY') {
          throw new ContractError({
            code: 'INVALID_ENTRY_CODE',
            message: '仅供本机模拟预览',
            retryable: 'no-retry',
          });
        }
        if (credential.client_versions.contract_version !== CONTRACT_VERSION)
          fail('接口版本不匹配', 'INVALID_EVENT');
        opened = true;
        return structuredClone(session);
      },
      async loadState(input) {
        checkSession(input);
        return {
          session_id: session.session_id,
          phase: receipt().current_phase,
          trial_index: 0,
          last_confirmed_event_id: events.at(-1)?.event_id ?? null,
          last_confirmed_sequence_no: events.at(-1)?.sequence_no ?? 0,
          completed,
          reconciliation_required: false,
        };
      },
      async finishSession(input) {
        checkSession(input);
        if (!has('session_completion_requested')) fail('必须先确认完整记录');
        completed = true;
        return receipt();
      },
      async describeCapabilities() {
        return {
          provider: session.provider,
          adapter_version: '0.3.0',
          capabilities: {
            persistentResults: 'unsupported',
            idempotentWrites: 'supported',
            resumeSession: 'unsupported',
            serverControlledTrials: 'unsupported',
            serverScoring: 'unsupported',
            individualEntryCodes: 'unsupported',
          },
        };
      },
    },
    trialService: {
      async loadTrial(input, trialId): Promise<PublicTrial> {
        checkTrial(input, trialId);
        return {
          trial_id: PREVIEW_TRIAL_ID,
          trial_index: 0,
          phase: 'main',
          machines,
          visible_history: machines.map((m, i) => ({
            trial_id: 'history-demo',
            machine_id: m.machine_id,
            observed_hit_rate: [0.7, 0.2, 0.1][i] ?? 0,
          })),
          advice_timing: 'after_choice',
          material_version: '0.3.0',
          performance_reference: { ...performanceReference },
          advice: has('advice_revealed')
            ? { ...advice }
            : { advice_id: advice.advice_id, revealed: false },
        };
      },
      async loadAdvice(input, trialId) {
        checkTrial(input, trialId);
        if (!has('source_selected')) fail('先保存独立预测、信心及来源选择');
        if (selfWithoutAdvice()) fail('自己来源不开放 AI 建议');
        adviceLoaded = true;
        return { ...advice };
      },
      async getFeedback(input, trialId) {
        checkTrial(input, trialId);
        const independent = events.find((e) => e.event_type === 'prediction_submitted');
        const final = events.find((e) => e.event_type === 'final_prediction_submitted');
        if (!independent || !final) fail('先保存最终预测');
        const winner = 'C'; // Fixed demo outcome: A's higher history rate does not make it correct.
        const evaluation = evaluateAdvice({
          exposed: has('advice_revealed'),
          target: advice.advice_target_machine_id,
          winner,
          independent: independent.payload.machine_id,
          final: final.payload.machine_id,
        });
        feedback ??= {
          trial_id: PREVIEW_TRIAL_ID,
          actual_winner_machine_id: winner,
          independent_correct: independent.payload.machine_id === winner,
          final_correct: final.payload.machine_id === winner,
          participant_predicted_winner: final.payload.machine_id === winner,
          advice_target_hit: null, // Deprecated; explicit reason is recorded in advice_evaluation.
          advice_actual_hit: evaluation.advice_correct,
          advice_evaluation: evaluation,
          points_awarded:
            final.payload.machine_id === winner ? performanceReference.points_per_correct : 0,
          scoring_version: '0.3.1',
          required_event_types: [...entryRequired, ...required].filter(
            (type) => !(selfWithoutAdvice() && type === 'advice_revealed'),
          ),
        };
        feedbackLoaded = true;
        return structuredClone(feedback);
      },
    },
    resultStore: {
      async saveEvents(input, incoming) {
        checkSession(input);
        const result = receipt();
        const acknowledged: string[] = [];
        const rejected: { event_id: string; reason_code: string; reason_message: string }[] = [];
        for (const candidate of incoming) {
          try {
            const event = parseEventEnvelope(candidate);
            if (
              event.session_id !== session.session_id ||
              event.participant_id !== session.participant_id
            ) {
              fail('事件身份不匹配', 'INVALID_EVENT');
            }
            const previous = byId.get(event.event_id);
            if (previous) {
              if (canonical(previous) !== canonical(event))
                throw new ContractError({
                  code: 'EVENT_CONFLICT',
                  message: '同一事件 ID 的内容发生变化',
                  retryable: 'no-retry',
                });
            } else {
              checkEvent(event);
              const copy = structuredClone(event);
              events.push(copy);
              byId.set(copy.event_id, copy);
            }
            if (!acknowledged.includes(event.event_id)) acknowledged.push(event.event_id);
          } catch (error) {
            // A contradictory repeated ID within one batch rejects the whole ID receipt,
            // while the original accepted record remains immutable for explicit recovery.
            const index = acknowledged.indexOf(candidate.event_id);
            if (index >= 0) acknowledged.splice(index, 1);
            if (!rejected.some((r) => r.event_id === candidate.event_id))
              rejected.push({
                event_id: candidate.event_id,
                reason_code: error instanceof ContractError ? error.code : 'INVALID_EVENT',
                reason_message: error instanceof Error ? error.message : '校验失败',
              });
          }
        }
        return {
          ...result,
          current_phase: receipt().current_phase,
          acknowledged_event_ids: acknowledged.filter(
            (id) => !rejected.some((r) => r.event_id === id),
          ),
          rejected_events: rejected,
        };
      },
    },
  };
}
