/**
 * Service interfaces (see docs/CONTRACTS.md §2).
 *
 * The split `SessionService / TrialService / ResultStore` is intentional:
 * platforms that only provide result storage must not pretend to offer an
 * experiment service (and vice-versa). Capabilities communicate the
 * asymmetry back to bootstrap.
 *
 * After the Q G0 review (R2), TrialService carries an explicit advice /
 * source-choice channel so B/C/D do not have to invent fields locally.
 */

import type { Capabilities } from './capabilities.js';
import type { EventEnvelope } from './envelopes.js';
import type { SaveReceipt } from './persistence-types.js';
import type { EntryCredential, ExperimentState, Session } from './session-types.js';
import type { RevealedAdviceBlock, PublicTrial, TrialFeedback } from './trial-types.js';

export interface SessionService {
  /** Establish or restore a session deterministically from a credential. */
  openSession(credential: EntryCredential): Promise<Session>;
  /** Server-validated progress; never trust a client-claimed state. */
  loadState(session: Session): Promise<ExperimentState>;
  /** Complete only after mandatory events are confirmed saved. */
  finishSession(session: Session): Promise<SaveReceipt>;
  /** Static description of what the backing service can do. */
  describeCapabilities(): Promise<Capabilities>;
}

/**
 * TrialService is the only path through which a UI can read trial material,
 * advice, source-choice labels, and feedback. Adapters MUST answer each
 * call according to the phase state in `loadState`; partial implementation
 * (e.g. a results store with no experiment service) must leave the
 * corresponding capability as `unsupported` and refuse the call.
 */
export interface TrialService {
  /** Phase-filtered trial material. Future outcomes & private seeds are stripped. */
  loadTrial(session: Session, trialId: string): Promise<PublicTrial>;
  /** Staged advice block from `loadTrial` once the participant qualifies for reveal. */
  loadAdvice(session: Session, trialId: string): Promise<RevealedAdviceBlock>;
  // All participant writes, including source and final answer, go through saveEvents.
  /** Trial feedback gated by persisted prediction events. */
  getFeedback(session: Session, trialId: string): Promise<TrialFeedback>;
}

export interface ResultStore {
  /**
   * Per-event acknowledgement; partial success is the default. The store
   * MUST round-trip the provided envelopes, including `payload`. If a
   * payload is silently dropped here, the integrity guarantee is gone.
   */
  saveEvents(session: Session, events: ReadonlyArray<EventEnvelope>): Promise<SaveReceipt>;
}

/** Composite adapter contract — one backing implementation provides all three. */
export interface ExperimentAdapter {
  readonly sessionService: SessionService;
  readonly trialService: TrialService;
  readonly resultStore: ResultStore;
}
