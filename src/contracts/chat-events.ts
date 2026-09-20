/**
 * Streaming chat event shapes for contract 0.3.0.
 * chatStreamEventSchema validates individual envelopes, not stream ordering.
 * experiment/chat-stream-reader.ts validates started/terminal placement,
 * contiguous text sequences, stable IDs, count, cancellation position and the
 * SHA-256 of the concatenated text. A terminal event does not prove persistence.
 * Current local presentation audit is in memory only.
 */

import type { SemverTag } from './protocol-versions.js';

export const CHAT_STREAM_EVENT_TYPES = [
  'started',
  'text_delta',
  'completed',
  'cancelled',
  'failed',
] as const;

export type ChatStreamEventType = (typeof CHAT_STREAM_EVENT_TYPES)[number];

export const CHAT_STREAM_ERROR_CODES = [
  'CHAT_TIMEOUT',
  'CHAT_RATE_LIMITED',
  'CHAT_PROVIDER_DOWN',
  'CHAT_OUTPUT_BLOCKED',
  'CHAT_INVALID_INPUT',
  'CHAT_UNKNOWN',
] as const;

export type ChatStreamErrorCode = (typeof CHAT_STREAM_ERROR_CODES)[number];

/** Marks `started`/`completed`/`cancelled`/`failed` variants with a stable
 *  -1 sequence; `text_delta` always increments strictly. */
export const CHAT_STREAM_NON_TEXT_SEQUENCE = -1 as const;

export interface ChatMessageMeta {
  readonly message_id: string;
  readonly request_id: string;
  /** Returned on `started` and `completed`; null on text_delta/cancelled/failed. */
  readonly author: 'assistant' | null;
  /** ISO 8601 UTC string captured by the adapter when the message is opened. */
  readonly opened_at: string;
  /** Provider-issued adapter version (e.g. `local-demo/0.4.0-rc`). */
  readonly adapter_version: string;
}

export interface ChatStreamEventBase {
  readonly event_id: string;
  readonly schema_version: SemverTag;
  readonly contract_version: SemverTag;
  readonly client_version: SemverTag;
  readonly material_version: SemverTag;
  readonly protocol_version: string;
  /** Same value across the entire reply (UUID v4). */
  readonly request_id: string;
  readonly message_meta: ChatMessageMeta;
  /** Monotonic per `request_id`. Non-text events use -1. */
  readonly sequence: number;
  /** Server timestamp; null if the adapter is local-only. */
  readonly server_timestamp: string | null;
}

export interface ChatStreamEventStarted extends ChatStreamEventBase {
  readonly type: 'started';
  readonly sequence: -1;
}

export interface ChatStreamEventTextDelta extends ChatStreamEventBase {
  readonly type: 'text_delta';
  /** Strictly increasing, ≥ 0, scoped per `request_id`. */
  readonly sequence: number;
  /** UTF-8 text chunk. Empty text is rejected (use case: zero-len carries no info). */
  readonly text: string;
  readonly author: 'assistant' | null;
}

export interface ChatStreamEventCompleted extends ChatStreamEventBase {
  readonly type: 'completed';
  readonly sequence: -1;
  /** sha256 hex of the concatenated `text_delta` payloads, 64 chars. */
  readonly content_hash: string;
  /** Total text_delta events (post-`started`); informational but enforced ≥ 0. */
  readonly total_text_deltas: number;
  /** Stream completion marker; does not imply a durable storage receipt. */
  readonly final: true;
}

export interface ChatStreamEventCancelled extends ChatStreamEventBase {
  readonly type: 'cancelled';
  readonly sequence: -1;
  /** Highest sequence number that has been rendered; deltas above are discarded. */
  readonly last_sequence: number;
}

export interface ChatStreamEventFailed extends ChatStreamEventBase {
  readonly type: 'failed';
  readonly sequence: -1;
  readonly code: ChatStreamErrorCode;
  readonly retryable: boolean;
  readonly error_message: string;
}

export type ChatStreamEvent =
  | ChatStreamEventStarted
  | ChatStreamEventTextDelta
  | ChatStreamEventCompleted
  | ChatStreamEventCancelled
  | ChatStreamEventFailed;

/** UI state machine mirror (see docs/CHAT_STATE_TABLE.md). */
export const CHAT_UI_STATES = [
  'idle',
  'awaiting_start',
  'streaming',
  'awaiting_completion',
  'completed',
  'cancelled',
  'failed',
  'retry_pending',
] as const;

export type ChatUiState = (typeof CHAT_UI_STATES)[number];
