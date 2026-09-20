/**
 * Chat-stream verification harness.
 *
 * Provides a single entry point that drains an async iterable, parses each
 * payload with `chatStreamEventSchema`, and enforces the streaming
 * invariants that schema-only tests cannot. Added to address Q's R5 audit
 * (post-U0): the original field-validation spec only showed that well-formed
 * fixtures round-trip; it did not exercise an actual consumer that would
 * catch out-of-order, duplicate, cross-request, or hash-mismatched streams.
 */

import { createHash } from 'node:crypto';

import { chatStreamEventSchema, type ChatStreamErrorCode } from '../../../src/contracts/index.js';

export type ChatStreamFailureCode = ChatStreamErrorCode;

export interface ChatStreamVerifyResult {
  ok: boolean;
  failure_reason?: string;
  failure_code?: ChatStreamFailureCode;
  acknowledged_deltas: number;
  computed_text_hash?: string;
  observed_terminal_type?: 'completed' | 'cancelled' | 'failed';
  events: ParsedStreamEvent[];
}

/** Result of zod-parsing a `chatStreamEvent` payload. Equivalent to
 *  `ChatStreamEvent` at runtime, but carries the post-zod type alias so
 *  the harness can collect them in a homogeneous array. */
export type ParsedStreamEvent = ReturnType<typeof chatStreamEventSchema.parse>;

export interface ChatStreamVerifyOptions {
  /** A second `request_id` is allowed when the test wants to assert that a
   *  same-streaming-loop receives a *different* request_id (cross-request
   *  smuggling). Default: `null` (cross-request detected as failure). */
  acceptSecondaryRequestId?: string | null;
}

export async function verifyChatStream(
  iterable: AsyncIterable<unknown>,
  expectedRequestId: string,
  options: ChatStreamVerifyOptions = {},
): Promise<ChatStreamVerifyResult> {
  const events: ParsedStreamEvent[] = [];
  let startedCount = 0;
  let terminalCount = 0;
  let terminalType: 'completed' | 'cancelled' | 'failed' | null = null;
  let lastTextDeltaSequence = -1;
  let accumulated = '';
  let computedHash: string | undefined;

  const fail = (reason: string, code: ChatStreamFailureCode): ChatStreamVerifyResult => ({
    ok: false,
    failure_reason: reason,
    failure_code: code,
    acknowledged_deltas: events.filter((e) => e.type === 'text_delta').length,
    computed_text_hash: computedHash,
    observed_terminal_type: terminalType ?? undefined,
    events,
  });

  for await (const raw of iterable) {
    const parsed = chatStreamEventSchema.safeParse(raw);
    if (!parsed.success) {
      return fail(
        `event schema mismatch: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        'CHAT_INVALID_INPUT',
      );
    }
    const evt = parsed.data;

    if (evt.request_id !== expectedRequestId) {
      if (
        options.acceptSecondaryRequestId !== null &&
        evt.request_id === options.acceptSecondaryRequestId
      ) {
        return fail(
          `cross-request contamination: expected ${expectedRequestId}, got ${evt.request_id}`,
          'CHAT_INVALID_INPUT',
        );
      }
      return fail(
        `unexpected request_id ${evt.request_id}; stream loop should only carry ${expectedRequestId}`,
        'CHAT_INVALID_INPUT',
      );
    }

    events.push(evt);

    if (evt.type === 'started') {
      startedCount += 1;
      if (startedCount > 1) {
        return fail(`repeated started (${startedCount} times)`, 'CHAT_UNKNOWN');
      }
    } else if (evt.type === 'text_delta') {
      if (startedCount === 0) {
        return fail('text_delta arrived before started', 'CHAT_UNKNOWN');
      }
      if (evt.sequence <= lastTextDeltaSequence) {
        return fail(
          `text_delta sequence ${evt.sequence} not greater than previous ${lastTextDeltaSequence}`,
          'CHAT_UNKNOWN',
        );
      }
      lastTextDeltaSequence = evt.sequence;
      accumulated += evt.text;
    } else {
      terminalCount += 1;
      terminalType = evt.type;
      if (terminalCount > 1) {
        return fail('multiple terminal events', 'CHAT_UNKNOWN');
      }
      if (evt.type === 'completed') {
        computedHash = createHash('sha256').update(accumulated, 'utf8').digest('hex');
        if (computedHash !== evt.content_hash) {
          return fail(
            `content_hash mismatch: client-computed ${computedHash}, server-reported ${evt.content_hash}`,
            'CHAT_PROVIDER_DOWN',
          );
        }
      }
    }
  }

  if (startedCount === 0) {
    return fail('stream ended without a started event', 'CHAT_UNKNOWN');
  }
  if (terminalCount === 0) {
    return fail('stream ended without a terminal event', 'CHAT_UNKNOWN');
  }

  return {
    ok: true,
    acknowledged_deltas: events.filter((e) => e.type === 'text_delta').length,
    computed_text_hash: computedHash,
    observed_terminal_type: terminalType ?? undefined,
    events,
  };
}

export async function* fixedEvents(events: ReadonlyArray<unknown>): AsyncIterable<unknown> {
  for (const event of events) yield event;
}

export async function* delayedEvents(
  events: ReadonlyArray<unknown>,
  delayMs: (index: number) => number,
): AsyncIterable<unknown> {
  for (let i = 0; i < events.length; i += 1) {
    const delay = delayMs(i);
    if (delay > 0) await sleep(delay);
    yield events[i];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
