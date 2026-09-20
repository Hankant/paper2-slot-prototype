/**
 * Trial-level data types (see docs/CONTRACTS.md §1 and §3).
 *
 * Trial data is split into "public" (what the participant may see at the
 * current phase) and "private" (private seed, full answers, AI advice target
 * — never included in any client-side payload). The runtime only ever
 * exchanges PublicTrial-shaped values across the network.
 *
 * After the Q G0 review (R2), `PublicTrial` carries the participants-facing
 * advice surface (machine + display position + reveal status) and a slot
 * for the participant's own prediction/confidence ahead of any source
 * choice. Adapters serve these blocks per `advice_timing` so the B/C/D
 * modules can render and record the demo flow without adding private fields.
 */

import type { ExperimentEventType } from './envelopes.js';
import type { SemverTag } from './protocol-versions.js';

export interface SlotMachineOption {
  /** Stable logical identifier; does not depend on screen layout. Must be unique across a trial. */
  readonly machine_id: string;
  /** Participant-visible screen position. Must be unique across a trial. */
  readonly display_position: 'left' | 'center' | 'right';
  /** Participant-facing label, never contains the true payout probability. */
  readonly label: string;
}

/**
 * Source choice taxonomy used in `source_selected` and `advice_revealed`
 * events. `no_advice_shown` is distinct from a missing choice: it
 * represents a participant who never saw advice.
 */
export const SOURCE_CHOICES = ['human', 'ai', 'mixed', 'no_advice_shown'] as const;
export type SourceChoice = (typeof SOURCE_CHOICES)[number];

/**
 * Advice block served to the participant. Omitted entirely when
 * `advice_timing === 'none'`; otherwise the block is staged under
 * `revealed` (false until the source decision has been recorded).
 */
export interface HiddenAdviceBlock {
  readonly advice_id: string;
  readonly revealed: false;
}

export interface RevealedAdviceBlock {
  readonly advice_id: string;
  /** Logical machine the advice points to; surfaced only after reveal. */
  readonly advice_target_machine_id: string;
  /** Display position of the advised machine; cross-checks against `machines`. */
  readonly advice_target_display_position: 'left' | 'center' | 'right';
  /** Brief copy the participant sees; must never include reasoning rationale. */
  readonly copy: string;
  /** Whether the answer behind the advice is currently visible. */
  readonly revealed: true;
}

export type PublicAdviceBlock = HiddenAdviceBlock | RevealedAdviceBlock;

export interface PublicTrial {
  readonly trial_id: string;
  readonly trial_index: number;
  readonly phase: 'practice' | 'calibration' | 'main';
  /** History visible at this phase; rewards are aggregated, never raw outcomes. */
  readonly visible_history: ReadonlyArray<SlotMachineHistoryEntry>;
  readonly machines: ReadonlyArray<SlotMachineOption>;
  /** Whether the advice block appears `before` or `after` the participant's independent prediction (T03). */
  readonly advice_timing: 'before_choice' | 'after_choice' | 'none';
  /** Hidden metadata only before reveal, or omitted; never preload the advice content. */
  readonly advice?: PublicAdviceBlock;
  readonly material_version: SemverTag;
}

export interface SlotMachineHistoryEntry {
  readonly trial_id: string;
  readonly machine_id: string;
  /** 0..1; rounded for display, full precision kept in private payload. */
  readonly observed_hit_rate: number;
}

/** Reference to the participant-submitted prediction. */
export interface ParticipantPrediction {
  readonly machine_id: string;
  readonly display_position: 'left' | 'center' | 'right';
  readonly confidence_percent: number;
  readonly elapsed_ms: number;
}

/**
 * Each labelled "answer" that an adapter can return. The independent
 * prediction is recorded before any advice reveal; the final prediction is
 * recorded after source choice. They MUST stay separate fields so a hidden
 * advice cannot be inferred from log changes.
 */
export interface FinalPredictionRecord {
  readonly independent: ParticipantPrediction;
  readonly final: ParticipantPrediction;
  readonly source_choice: SourceChoice;
  readonly changed_after_advice: boolean;
}

/**
 * Outcome revealed only after the participant has confirmed all required
 * predictions AND the backend has acknowledged their save receipt. Adapters
 * must not release this payload earlier.
 */
export interface TrialFeedback {
  readonly trial_id: string;
  readonly actual_winner_machine_id: string;
  readonly participant_predicted_winner: boolean;
  /** Deprecated: original meaning was never specified. Null is NOT an exposure flag. */
  readonly advice_target_hit: boolean | null;
  /** Whether presented advice predicts the actual winner; null when unexposed. */
  readonly advice_actual_hit: boolean | null;
  /** Explicit descriptive fields introduced by the 0.3.1 scoring repair. */
  readonly advice_evaluation?: {
    readonly evaluation_version: '1.0.0';
    readonly advice_exposed: boolean;
    readonly advice_target_machine_id: string | null;
    readonly advice_correct: boolean | null;
    readonly independent_matches_advice: boolean | null;
    readonly final_matches_advice: boolean | null;
    readonly switched_to_advice: boolean | null;
    readonly legacy_target_hit_reason: 'undefined_legacy_field';
  };
  readonly points_awarded: number;
  readonly scoring_version: SemverTag;
  /** Independent vs final prediction correctness, separately tracked. */
  readonly independent_correct: boolean;
  readonly final_correct: boolean;
  /** Events required by TrialService to release this payload. */
  readonly required_event_types: ReadonlyArray<ExperimentEventType>;
}
