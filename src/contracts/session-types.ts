/**
 * Session-shape types (see docs/CONTRACTS.md §1 and §2).
 *
 * `Session` is the bearer of identity, group assignment, batch marker, and
 * the adapter version that handled it. `ExperimentState` is the resumable
 * progress — it must be re-validated server-side; the browser cannot
 * silently advance phase.
 */

import type { SemverTag } from './protocol-versions.js';
import type { ExperimentPhase, ParticipationMode, SessionMetadata } from './envelopes.js';
import type { PerformanceReference } from './trial-types.js';

export interface Session {
  readonly session_id: string;
  readonly participant_id: string;
  readonly recruitment_batch: string;
  readonly group_assignment: string;
  readonly study_id: string;
  readonly protocol_version: string;
  readonly material_version: SemverTag;
  readonly contract_version: SemverTag;
  readonly adapter_version: string;
  readonly provider: string;
  readonly condition_assignment?: PerformanceReference;
  readonly metadata: SessionMetadata;
}

export interface EntryCredential {
  /** Random, non-guessable identifier provided to a participant. */
  readonly entry_code: string;
  /** Probe that becomes `participation_mode` once confirmed. */
  readonly observed_participation_mode: ParticipationMode;
  /** Probe that becomes `device_class` once confirmed. */
  readonly observed_device_class: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  readonly client_versions: {
    readonly protocol_version: string;
    readonly contract_version: SemverTag;
    readonly material_version: SemverTag;
    readonly client_version: SemverTag;
  };
}

export interface ExperimentState {
  readonly session_id: string;
  readonly phase: ExperimentPhase;
  /** 0-indexed position inside the current `phase`. */
  readonly trial_index: number;
  readonly last_confirmed_event_id: string | null;
  readonly last_confirmed_sequence_no: number;
  readonly completed: boolean;
  /** Refusal to honour stale client state — adapters re-validate. */
  readonly reconciliation_required: boolean;
}
