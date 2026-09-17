/**
 * Save-receipt and persistence types (see docs/CONTRACTS.md §4).
 *
 * A 200 response, a "submitted" message, and a successful write to browser
 * cache are NOT persistence. The receipt is the only thing that can flip
 * `persistence_scope` to `remote`.
 *
 * After the Q G0 review (R3), the validator additionally enforces:
 *   - `remote` requires `persisted_at` AND `receipt_id` to be non-null
 *   - non-`remote` scopes require both to be null
 *   - `acknowledged_event_ids`, `rejected_events[].event_id`,
 *     `unconfirmed_event_ids` are pairwise disjoint
 *   - each list is internally deduplicated
 */

import type { ExperimentPhase } from './envelopes.js';

export const PERSISTENCE_SCOPES = ['memory', 'browser_local', 'remote'] as const;
export type PersistenceScope = (typeof PERSISTENCE_SCOPES)[number];

export const SESSION_STATUSES = [
  'opening',
  'in_progress',
  'awaiting_completion',
  'completed',
  'expired',
  'errored',
] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface RejectedEventRecord {
  readonly event_id: string;
  readonly reason_code: string;
  readonly reason_message: string;
}

export interface SaveReceipt {
  readonly acknowledged_event_ids: ReadonlyArray<string>;
  readonly rejected_events: ReadonlyArray<RejectedEventRecord>;
  /** Events the adapter saw but neither accepted nor rejected (network drop, etc.). */
  readonly unconfirmed_event_ids: ReadonlyArray<string>;
  readonly persistence_scope: PersistenceScope;
  readonly session_status: SessionStatus;
  /** Server timestamp when available; null for non-remote scopes. */
  readonly persisted_at: string | null;
  /** Backend-issued receipt id; null when scope is not `remote`. */
  readonly receipt_id: string | null;
  readonly current_phase: ExperimentPhase;
}
