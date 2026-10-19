import { QUESTIONNAIRE_INSTRUMENT } from '../../domain/questionnaire-instrument-demo.js';
import { validateQuestionnaireSubmission } from '../../domain/questionnaire-validation.js';
import {
  experimentPlanSchema,
  trialIds,
  type ExperimentPlan,
} from '../../contracts/experiment-plan.js';
/** One deterministic, memory-only preview. Answers are in the browser: NEVER use for recruitment. */
import {
  CONTRACT_VERSION,
  SCHEMA_VERSION,
  CLIENT_VERSION,
  ContractError,
  parseEventEnvelope,
  type BlockSpec,
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

interface TrialMaterial {
  readonly trial_id: string;
  readonly block_id: string;
  readonly block_kind: 'test' | 'formal';
  readonly trial_index_in_block: number;
  readonly advice_target_machine_id: 'A' | 'B' | 'C';
  readonly actual_winner: 'A' | 'B' | 'C';
}

function buildTrialMaterial(
  blocks: ReadonlyArray<BlockSpec>,
  rate: number,
  seed: string,
): ReadonlyArray<TrialMaterial> {
  // The collection server supplies a private random seed persisted only in SQLite.
  let state = 2166136261;
  for (const c of seed) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  if (state === 0) state = 1;
  const out: TrialMaterial[] = [];
  const ids = ['A', 'B', 'C'] as const;
  function at(index: number) {
    const id = ids[index];
    if (!id) throw new Error('机器索引越界');
    return id;
  }
  for (const block of blocks) {
    const hitFlags = Array.from(
      { length: block.total_trials },
      (_, i) => i < Math.round(block.total_trials * rate),
    );
    for (let i = hitFlags.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [hitFlags[i], hitFlags[j]] = [Boolean(hitFlags[j]), Boolean(hitFlags[i])];
    }
    for (let i = 0; i < block.total_trials; i++) {
      const winnerIndex = Math.floor(random() * 3);
      out.push({
        trial_id: `${block.block_id}-trial-${i}`,
        block_id: block.block_id,
        block_kind: block.block_kind,
        trial_index_in_block: i,
        actual_winner: at(winnerIndex),
        advice_target_machine_id: at(
          hitFlags[i] ? winnerIndex : (winnerIndex + 1 + Math.floor(random() * 2)) % 3,
        ),
      });
    }
  }
  return out;
}

function fail(message: string, code: 'OUT_OF_ORDER' | 'INVALID_EVENT' = 'OUT_OF_ORDER'): never {
  throw new ContractError({ code, message, retryable: 'no-retry' });
}

/** minimax (2026-09-23): type guards for narrowing the EventEnvelope
 *  discriminated union when reading per-trial payloads. */
function isPrediction(
  e: EventEnvelope,
): e is EventEnvelope & { readonly event_type: 'prediction_submitted' } {
  return e.event_type === 'prediction_submitted';
}
function isFinalPrediction(
  e: EventEnvelope,
): e is EventEnvelope & { readonly event_type: 'final_prediction_submitted' } {
  return e.event_type === 'final_prediction_submitted';
}
function isSourceSelected(
  e: EventEnvelope,
): e is EventEnvelope & { readonly event_type: 'source_selected' } {
  return e.event_type === 'source_selected';
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
    /**
     * minimax (2026-09-23): when provided, the preview serves one PublicTrial
     * per block-trial and emits `block_intro_presented` / `block_completed`
     * entry-level events between blocks. When omitted, the legacy
     * single-trial behaviour is preserved verbatim (backward compatibility).
     */
    blocks?: ReadonlyArray<BlockSpec>;
    plan?: ExperimentPlan;
    privateSeed?: string;
  } = {},
): ExperimentAdapter & { exportEvents(): EventEnvelope[] } {
  const seed = options.seedSession ?? {};
  const performanceReference =
    seed.condition_assignment ?? options.performanceReference ?? DEFAULT_PERFORMANCE_REFERENCE;
  const planInput = seed.experiment_plan ?? options.plan;
  const plan = planInput
    ? experimentPlanSchema.parse(planInput)
    : options.blocks
      ? experimentPlanSchema.parse({
          version: 'blocks-v1',
          modules: options.blocks.map((block) => ({ kind: 'trials', block })),
        })
      : undefined;
  const multiBlock = plan !== undefined;
  const blocks = plan?.modules.flatMap((m) => (m.kind === 'trials' ? [m.block] : [])) ?? [];
  const trialMaterial = multiBlock
    ? buildTrialMaterial(
        blocks,
        performanceReference.ai_hit_rate,
        options.privateSeed ?? 'preview-only-v2',
      )
    : [];
  const trialById = new Map<string, TrialMaterial>(trialMaterial.map((t) => [t.trial_id, t]));
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
    ...(plan ? { experiment_plan: plan } : {}),
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
  if (options.requirePractice && !multiBlock) entryRequired.push('practice_completed');
  let opened = false;
  let completed = false;
  const adviceLoadedTrials = new Set<string>();
  const feedbackLoadedTrials = new Set<string>();
  let adviceLoaded = false;
  let feedbackLoaded = false;
  let feedback: TrialFeedback | undefined;
  // minimax (2026-09-23): per-trial feedback cache for the multi-block
  // preview. The single-trial closure-scoped `feedback` above still works
  // because there is only one trialId; for multi-block each trial has its
  // own realised winner and we must not return a stale value.
  const feedbackByTrial = new Map<string, TrialFeedback>();

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
    if (multiBlock) {
      if (!trialById.has(trialId)) fail('未知试次', 'INVALID_EVENT');
    } else {
      if (trialId !== PREVIEW_TRIAL_ID) fail('未知试次', 'INVALID_EVENT');
    }
  }
  function has(type: ExperimentEventType): boolean {
    return events.some((e) => e.event_type === type);
  }
  function selfWithoutAdvice(trialId?: string): boolean {
    if (options.adviceForSelf !== false) return false;
    return events.some(
      (e) =>
        isSourceSelected(e) &&
        e.payload.source === 'human' &&
        (trialId === undefined || e.trial_id === trialId),
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
            : multiBlock
              ? 'main'
              : 'main',
    };
  }
  function adviceFor(trialId: string): RevealedAdviceBlock {
    const material = trialById.get(trialId);
    if (!material) return { ...advice };
    const position = machines.find(
      (m) => m.machine_id === material.advice_target_machine_id,
    )?.display_position;
    return {
      advice_id: `${trialId}-advice`,
      revealed: true,
      advice_target_machine_id: material.advice_target_machine_id,
      advice_target_display_position: position ?? 'center',
      copy: `综合本轮信息，我建议选择机器 ${material.advice_target_machine_id}。建议仅供参考，请由你确认最终预测。`,
    };
  }
  function getTrialSequenceNo(trialId: string): number {
    return events.filter((e) => e.trial_id === trialId).length;
  }
  function checkEvent(event: EventEnvelope): void {
    if (completed) fail('会话已结束', 'INVALID_EVENT');
    if (
      event.event_type === 'questionnaire_block_submitted' &&
      session.questionnaire_validation_version === '1.0.0'
    )
      validateQuestionnaireSubmission(QUESTIONNAIRE_INSTRUMENT, event.payload);
    if (event.sequence_no !== events.length) fail('事件顺序或序号错误');
    if (multiBlock && plan) {
      const next = plan.modules.find((m) =>
        m.kind === 'trials'
          ? !events.some(
              (e) => e.event_type === 'block_completed' && e.payload.block_id === m.block.block_id,
            )
          : !m.block_ids.every((id) =>
              events.some(
                (e) =>
                  e.event_type === 'questionnaire_block_submitted' && e.payload.block_id === id,
              ),
            ),
      );
      const consented = !options.requireConsentVersion || has('consent_recorded');
      if (event.event_type === 'consent_recorded') {
        if (has('consent_recorded') || events.length !== 0) fail('参与同意记录重复');
      } else {
        if (!consented) fail('请先确认参与说明');
        if (event.event_type === 'session_completion_requested') {
          if (
            next ||
            has('session_completion_requested') ||
            event.payload.ack_required_event_count !== events.length
          )
            fail('流程尚未完成或确认数量错误');
        } else if (event.event_type === 'questionnaire_block_submitted') {
          if (next?.kind !== 'questionnaire') fail('尚未到此问卷模块');
          const expectedId = next.block_ids.find(
            (id) =>
              !events.some(
                (e) =>
                  e.event_type === 'questionnaire_block_submitted' && e.payload.block_id === id,
              ),
          );
          if (
            event.payload.block_id !== expectedId ||
            event.payload.position !== next.position ||
            event.payload.instrument_version !== next.instrument_version
          )
            fail('问卷顺序或版本不匹配');
        } else {
          if (next?.kind !== 'trials') fail('尚未到试次模块');
          const block = next.block;
          const intro = events.some(
            (e) =>
              e.event_type === 'block_intro_presented' && e.payload.block_id === block.block_id,
          );
          const ids = trialIds(block);
          if (event.event_type === 'block_intro_presented') {
            if (
              intro ||
              event.payload.block_id !== block.block_id ||
              event.payload.block_kind !== block.block_kind ||
              event.payload.block_index !== block.block_index ||
              event.payload.total_trials !== block.total_trials ||
              event.payload.intro_notice !== block.intro_notice
            )
              fail('环节介绍与配置不一致');
          } else if (event.event_type === 'block_completed') {
            if (
              !intro ||
              event.payload.block_id !== block.block_id ||
              event.payload.block_kind !== block.block_kind ||
              event.payload.block_index !== block.block_index ||
              !ids.every((id) =>
                events.some((e) => e.trial_id === id && e.event_type === 'feedback_presented'),
              )
            )
              fail('环节尚未完成');
            const correct = ids.filter((id) => feedbackByTrial.get(id)?.final_correct).length;
            if (
              event.payload.trials_completed !== ids.length ||
              event.payload.correct_count !== correct ||
              event.payload.total_points_earned !==
                correct * performanceReference.points_per_correct ||
              !event.payload.had_source_choice ||
              event.payload.score_excluded_from_formal !== block.scores_excluded_from_formal
            )
              fail('环节统计与服务端不一致');
          } else {
            const tid = event.trial_id;
            const active = ids.find(
              (id) =>
                !events.some((e) => e.trial_id === id && e.event_type === 'feedback_presented'),
            );
            if (!intro || !tid || tid !== active) fail('试次未开放或上一轮尚未完成');
            const expected = [...required, 'feedback_presented'].filter(
              (type) => !(selfWithoutAdvice(tid) && type === 'advice_revealed'),
            );
            if (expected[getTrialSequenceNo(tid)] !== event.event_type) fail('试次内事件顺序错误');
            if (
              event.event_type === 'advice_revealed' &&
              (!adviceLoadedTrials.has(tid) ||
                event.payload.advice_id !== adviceFor(tid).advice_id ||
                event.payload.revealed_at_phase !==
                  (block.block_kind === 'test' ? 'practice' : 'main'))
            )
              fail('建议尚不可展示');
            if (event.event_type === 'feedback_presented' && !feedbackLoadedTrials.has(tid))
              fail('尚未读取本轮反馈');
            if (event.event_type === 'final_prediction_submitted') {
              const independent = events.find(
                (e) => e.trial_id === tid && e.event_type === 'prediction_submitted',
              );
              if (
                independent?.event_type !== 'prediction_submitted' ||
                event.payload.changed_after_advice !==
                  (independent.payload.machine_id !== event.payload.machine_id)
              )
                fail('改选标志不一致');
            }
          }
        }
      }
    } else if (event.event_type === 'questionnaire_block_submitted') {
      if (
        events.some(
          (e) =>
            e.event_type === 'questionnaire_block_submitted' &&
            e.payload.block_id === event.payload.block_id,
        )
      )
        fail('问卷区块重复');
      if (event.payload.position === 'pre') {
        if (has('prediction_submitted')) fail('前测必须在主任务前完成');
        if (options.requireConsentVersion && !has('consent_recorded')) fail('请先确认参与说明');
      } else if (!has('feedback_presented') || has('session_completion_requested'))
        fail('后测必须在结果呈现后、完成请求前提交');
    } else {
      const core = events.filter((e) => e.event_type !== 'questionnaire_block_submitted');
      const expected = [...entryRequired, ...order].filter(
        (type) => !(selfWithoutAdvice() && type === 'advice_revealed'),
      )[core.length];
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
            : event.event_type === 'session_completion_requested' && multiBlock
              ? 'finalizing'
              : event.event_type === 'block_intro_presented'
                ? 'practice'
                : event.event_type === 'block_completed'
                  ? 'finalizing'
                  : // minimax (2026-09-23): trial-level events now follow the
                    // trial's block_kind (test → practice; formal → main).
                    // Resolve the trial's block_kind from trialById rather
                    // than the trial's metadata so the validator matches
                    // whatever the run wrote.
                    trialById.get(event.trial_id ?? '')?.block_kind === 'test'
                    ? 'practice'
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
    if (event.trial_id !== undefined) {
      if (multiBlock) {
        if (!trialById.has(event.trial_id)) fail('试次不匹配', 'INVALID_EVENT');
      } else if (event.trial_id !== PREVIEW_TRIAL_ID) {
        fail('试次不匹配', 'INVALID_EVENT');
      }
    }
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
      !multiBlock &&
      event.event_type === 'advice_revealed' &&
      (!adviceLoaded ||
        event.payload.advice_id !== advice.advice_id ||
        event.payload.revealed_at_phase !== 'main')
    )
      fail('建议尚不可展示');
    if (event.event_type === 'feedback_presented' && !multiBlock && !feedbackLoaded)
      fail('尚未读取反馈');
    if (
      !multiBlock &&
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
          trial_index: events.filter((e) => e.event_type === 'feedback_presented').length,
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
        const trialAdvice = multiBlock ? adviceFor(trialId) : advice;
        const trialHistory = [0.7, 0.2, 0.1, 0.45, 0.3, 0.25, 0.5, 0.15, 0.35, 0.4, 0.4, 0.2];
        const material = multiBlock ? trialById.get(trialId) : undefined;
        const totalTrials = material
          ? (blocks.find((b) => b.block_id === material.block_id)?.total_trials ?? 1)
          : 1;
        const historyRates = material
          ? machines.map(
              (_, i) =>
                trialHistory[(material.trial_index_in_block * 3 + i) % trialHistory.length] ?? 0,
            )
          : [0.7, 0.2, 0.1];
        const adviceAlreadyRevealed = events.some(
          (e) => e.trial_id === trialId && e.event_type === 'advice_revealed',
        );
        return {
          trial_id: multiBlock ? trialId : PREVIEW_TRIAL_ID,
          trial_index: material?.trial_index_in_block ?? 0,
          phase: material?.block_kind === 'test' ? 'practice' : 'main',
          // minimax (2026-09-23): block metadata for orchestrator routing.
          block_id: material?.block_id ?? 'preview-block',
          block_kind: material?.block_kind ?? 'formal',
          trial_index_in_block: material?.trial_index_in_block ?? 0,
          block_total_trials: totalTrials,
          machines,
          visible_history: machines.map((m, i) => ({
            trial_id: `${trialId}-history`,
            machine_id: m.machine_id,
            observed_hit_rate: historyRates[i] ?? 0,
          })),
          advice_timing: 'after_choice',
          material_version: '0.3.0',
          performance_reference: { ...performanceReference },
          advice: adviceAlreadyRevealed
            ? { ...trialAdvice }
            : { advice_id: trialAdvice.advice_id, revealed: false },
        };
      },
      async loadAdvice(input, trialId) {
        checkTrial(input, trialId);
        if (multiBlock) {
          // Per-trial source_selected check.
          if (!events.some((e) => e.trial_id === trialId && e.event_type === 'source_selected'))
            fail('先保存独立预测、信心及来源选择');
          if (selfWithoutAdvice(trialId)) fail('自己来源不开放 AI 建议');
          adviceLoadedTrials.add(trialId);
          return adviceFor(trialId);
        }
        if (!has('source_selected')) fail('先保存独立预测、信心及来源选择');
        if (selfWithoutAdvice()) fail('自己来源不开放 AI 建议');
        adviceLoaded = true;
        return { ...advice };
      },
      async getFeedback(input, trialId) {
        checkTrial(input, trialId);
        if (multiBlock) {
          const independent = events.find(
            (e): e is EventEnvelope & { readonly event_type: 'prediction_submitted' } =>
              e.trial_id === trialId && e.event_type === 'prediction_submitted',
          );
          const final = events.find(
            (e): e is EventEnvelope & { readonly event_type: 'final_prediction_submitted' } =>
              e.trial_id === trialId && e.event_type === 'final_prediction_submitted',
          );
          if (!independent || !final) fail('先保存最终预测');
          const material = trialById.get(trialId);
          const winner = material?.actual_winner ?? 'B';
          const trialAdvice = adviceFor(trialId);
          const evaluation = evaluateAdvice({
            exposed: events.some(
              (e) => e.trial_id === trialId && e.event_type === 'advice_revealed',
            ),
            target: trialAdvice.advice_target_machine_id,
            winner,
            independent: independent.payload.machine_id,
            final: final.payload.machine_id,
          });
          const cached = feedbackByTrial.get(trialId);
          const built: TrialFeedback = cached ?? {
            trial_id: trialId,
            actual_winner_machine_id: winner,
            independent_correct: independent.payload.machine_id === winner,
            final_correct: final.payload.machine_id === winner,
            participant_predicted_winner: final.payload.machine_id === winner,
            advice_target_hit: null,
            advice_actual_hit: evaluation.advice_correct,
            advice_evaluation: evaluation,
            points_awarded:
              final.payload.machine_id === winner ? performanceReference.points_per_correct : 0,
            scoring_version: '0.3.1',
            required_event_types: required.filter(
              (type) => !(selfWithoutAdvice(trialId) && type === 'advice_revealed'),
            ),
          };
          feedbackByTrial.set(trialId, built);
          feedbackLoadedTrials.add(trialId);
          return structuredClone(built);
        }
        const independent = events.find(isPrediction);
        const final = events.find(isFinalPrediction);
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
