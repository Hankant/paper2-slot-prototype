/**
 * Public event envelope (see docs/CONTRACTS.md §3 and
 * sources/architecture-2026-09-17.md §4.2).
 *
 * Every raw event written to a ResultStore carries one of these envelopes.
 * `client_timestamp` is captured on the device; server-recorded receive time
 * is added by adapters and lives outside the envelope.
 *
 * Each event has:
 *   - a stable base (schema_version, contract_version, ...trial_id, payload?)
 *   - an `event_type` discriminator; validators refine payload/trial_id by it
 *   - a server-added receipt time that lives OUTSIDE the envelope
 *
 * Trial-level events REQUIRE `trial_id`:
 *   prediction_submitted, confidence_submitted, source_selected,
 *   advice_revealed, final_prediction_submitted, feedback_presented.
 * Comprehension and visibility events may also occur outside a trial.
 *
 * Entry-level events MUST NOT carry `trial_id`:
 *   consent_recorded, profile_submitted, session_completion_requested
 */

import type { SemverTag } from './protocol-versions.js';

export const PARTICIPATION_MODES = ['on_site', 'remote', 'unknown'] as const;
export type ParticipationMode = (typeof PARTICIPATION_MODES)[number];

export const DEVICE_CLASSES = ['mobile', 'desktop', 'tablet', 'unknown'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export interface SessionIdentifiers {
  readonly session_id: string;
  readonly participant_id: string;
}

export interface EventEnvelopeBase {
  readonly schema_version: SemverTag;
  readonly contract_version: SemverTag;
  readonly protocol_version: string;
  readonly material_version: string;
  readonly client_version: SemverTag;
  readonly session_id: string;
  readonly participant_id: string;
  readonly event_id: string;
  readonly sequence_no: number;
  /** Present on trial-level events, absent on entry-level events. */
  readonly trial_id?: string;
  readonly phase: ExperimentPhase;
  readonly event_type: ExperimentEventType;
  readonly client_timestamp: string;
  readonly elapsed_ms: number;
  /**
   * Captures what the participant actually did. Always round-tripped by the
   * validator — adapters must persist it as written. Shape is constrained by
   * `event_type`; see `validators.ts` for the per-event schemas.
   */
  readonly payload: unknown;
}

export type ExperimentPhase =
  | 'entry'
  | 'consent'
  | 'profile'
  | 'instructions'
  | 'practice'
  | 'calibration'
  | 'main'
  | 'finalizing'
  | 'completed'
  | 'cancelled';

export const EXPERIMENT_EVENT_TYPES = [
  'consent_recorded',
  'profile_submitted',
  'comprehension_answered',
  'prediction_submitted',
  'confidence_submitted',
  'source_selected',
  'final_prediction_submitted',
  'advice_revealed',
  'feedback_presented',
  'visibility_changed',
  'questionnaire_block_submitted',
  'session_completion_requested',
] as const;

export type ExperimentEventType = (typeof EXPERIMENT_EVENT_TYPES)[number];

/** Events that must be associated with a specific trial. */
export const TRIAL_LEVEL_EVENTS: ReadonlyArray<ExperimentEventType> = [
  'prediction_submitted',
  'confidence_submitted',
  'source_selected',
  'final_prediction_submitted',
  'advice_revealed',
  'feedback_presented',
];

/** Events that must NOT carry a trial_id. */
export const ENTRY_LEVEL_EVENTS: ReadonlyArray<ExperimentEventType> = [
  'consent_recorded',
  'profile_submitted',
  'questionnaire_block_submitted',
  'session_completion_requested',
];

export interface SessionMetadata {
  readonly participation_mode: ParticipationMode;
  readonly device_class: DeviceClass;
  readonly recruitment_batch: string;
  readonly adapter_version: string;
  readonly provider: string;
}

export type EnvelopeWithTrial = EventEnvelopeBase & { readonly trial_id: string };

/** Typed public payloads; the runtime validator mirrors this map. */
export interface EventPayloadMap {
  consent_recorded: { version: string };
  profile_submitted: { fields: Record<string, unknown> };
  comprehension_answered: { question_id: string; answer: unknown; correct: boolean | null };
  prediction_submitted: { machine_id: string; display_position: 'left' | 'center' | 'right' };
  confidence_submitted: { confidence_percent: number };
  source_selected: { source: 'human' | 'ai' | 'mixed' | 'no_advice_shown' };
  final_prediction_submitted: {
    machine_id: string;
    display_position: 'left' | 'center' | 'right';
    changed_after_advice: boolean;
  };
  advice_revealed: { advice_id: string; revealed_at_phase: ExperimentPhase };
  feedback_presented: { presented_at_ms: number };
  visibility_changed: { element_id: string; visible: boolean };
  questionnaire_block_submitted: {
    block_id: string;
    instrument_version: string;
    wording_profile: 'SELF_AI' | 'HUMAN_AI';
    position: 'pre' | 'post';
    item_order: string[];
    responses: Array<{
      item_id: string;
      value: string | number | string[] | null;
      skipped: boolean;
      response_ms: number;
    }>;
  };
  session_completion_requested: { ack_required_event_count: number };
}

type RequiredTrialEvent =
  | 'prediction_submitted'
  | 'confidence_submitted'
  | 'source_selected'
  | 'final_prediction_submitted'
  | 'advice_revealed'
  | 'feedback_presented';
type EntryEvent =
  | 'consent_recorded'
  | 'profile_submitted'
  | 'questionnaire_block_submitted'
  | 'session_completion_requested';
export type EventEnvelope = {
  [K in ExperimentEventType]: Omit<EventEnvelopeBase, 'event_type' | 'payload' | 'trial_id'> & {
    readonly event_type: K;
    readonly payload: EventPayloadMap[K];
  } & (K extends RequiredTrialEvent
      ? { readonly trial_id: string }
      : K extends EntryEvent
        ? { readonly trial_id?: never }
        : { readonly trial_id?: string });
}[ExperimentEventType];
