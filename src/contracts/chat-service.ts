/**
 * ChatService 0.3.0: replaceable streaming transport, separate from TrialService.
 * The immersive preview saves source_selected and waits for its receipt before
 * loadAdvice / streamReply. It implements only the AI source; mixed remains a
 * reserved contract value. Authorization checks the released advice block, not
 * an advice_revealed event that has not yet been presented.
 * The UI records advice_revealed after the standard answer is fully rendered in
 * an open, visible conversation. Completion does not submit a final prediction.
 * Chat chunks are validated by experiment/chat-stream-reader.ts and retained in
 * the preview's in-memory presentation_audit, not a durable remote transcript.
 * See docs/ATELIER_IMPLEMENTATION.md for current implementation boundaries.
 */

import type { SourceChoice } from './trial-types.js';
import type { ChatStreamEvent } from './chat-events.js';
import type { SemverTag } from './protocol-versions.js';

export const CHAT_SOURCE_CHOICES_FOR_INVOCATION: ReadonlyArray<SourceChoice> = ['ai', 'mixed'];

export interface ChatRequestVersions {
  readonly contract_version: SemverTag;
  readonly material_version: SemverTag;
  readonly client_version: SemverTag;
  readonly protocol_version: string;
}

export interface ChatRequest {
  /** Same as `Session.session_id`. */
  readonly session_id: string;
  /** Same as `PublicTrial.trial_id`. */
  readonly trial_id: string;
  /** Advice record identifier, taken from `RevealedAdviceBlock.advice_id`. */
  readonly advice_id: string;
  /** UUID v4, generated client-side; identical to `ChatStreamEvent.request_id`. */
  readonly request_id: string;
  /** Pre-trim user text. Empty or whitespace-only input is rejected. */
  readonly user_text: string;
  /** Adapter-supplied source choice at the moment of invocation. */
  readonly source_choice: SourceChoice;
  /** UI locale; the local preview records it in its exported request audit. */
  readonly locale: string;
  /** Capped, conservative input length (≤ 2000 chars by default). */
  readonly user_text_chars: number;
  readonly client_versions: ChatRequestVersions;
}

/**
 * Public ChatService contract. U0 only freezes the SIGNATURE; no
 * implementation is wired in U0. LocalChatAdapter lands in C's U2 scope;
 * real adapter lands in C's U5 scope.
 */
export interface ChatService {
  /**
   * Stream one assistant reply. The returned async iterable:
   *   - MUST yield exactly one `started` first
   *   - THEN zero-or-more `text_delta` in strictly increasing `sequence`
   *   - THEN exactly one terminal event among `completed` / `cancelled` / `failed`
   *
   * The caller can `AbortSignal` to halt the request. Adapters must map
   * `signal.aborted` to a terminal `cancelled` event with `last_sequence`
   * equal to the highest number already yielded, OR to a terminal `failed`
   * with `code='CHAT_TIMEOUT'` if the cancel races the timeout.
   *
   * Adapters MUST NOT silently drop textual content; the saved transcript
   * equals `concat(text_delta.text by sequence)` for clients that need a
   * stable audit trail.
   */
  streamReply(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;

  /** Capability descriptor — same shape as SessionService. */
  describeCapabilities(): Promise<import('./capabilities.js').Capabilities>;
}

/** Marker for A's U0 commitment: ChatService is *contract-frozen*, not
 *  implementation-frozen. Implementations must reach this signature.
 *  Allowed widening: adding new ChatStreamEvent variants only via a new
 *  contract_version (e.g. 0.4.0-rc). */
export const CHAT_SERVICE_COMPATIBILITY_NOTE =
  '0.3.0: ChatService.streamReply signature is contract-frozen. ' +
  'Implementations (LocalChatAdapter in U2, real adapter in U5) must conform. ' +
  'Allowed widening: adding new ChatStreamEvent variants only via a new contract_version.';
