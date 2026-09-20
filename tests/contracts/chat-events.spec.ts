import { describe, expect, it } from 'vitest';

import {
  chatRequestSchema,
  chatStreamEventCancelledSchema,
  chatStreamEventCompletedSchema,
  chatStreamEventFailedSchema,
  chatStreamEventSchema,
  chatStreamEventStartedSchema,
  chatStreamEventTextDeltaSchema,
} from '../../src/contracts/validators.js';
import {
  CHAT_SOURCE_CHOICES_FOR_INVOCATION,
  CHAT_STREAM_ERROR_CODES,
  CHAT_STREAM_EVENT_TYPES,
} from '../../src/contracts/index.js';
import {
  CHAT_STREAM_CANCELLED,
  CHAT_STREAM_COMPLETED,
  CHAT_STREAM_FAILED,
  CHAT_STREAM_STARTED,
  CHAT_TEXT_DELTA_FIRST,
  CHAT_TEXT_DELTA_SECOND,
  FULL_CHAT_STREAM,
  REJECTED_CHAT_CANCELLED_BAD_LASTSEQ,
  REJECTED_CHAT_COMPLETED_BAD_HASH,
  REJECTED_CHAT_DELTA_EMPTY_TEXT,
  REJECTED_CHAT_DELTA_NEGATIVE_SEQ,
  REJECTED_CHAT_FAILED_EMPTY_MSG,
  REJECTED_CHAT_REQUEST_CHAR_MISMATCH,
  REJECTED_CHAT_REQUEST_EMPTY,
  REJECTED_CHAT_REQUEST_HUMAN,
  SUCCESS_CHAT_REQUEST,
} from '../fixtures/chat-fixtures.js';

describe('contracts: chat stream events (U0 0.4.0-rc)', () => {
  it('declares the 5-variant event type set from IMMERSIVE_UI_PLAN §4.2', () => {
    expect([...CHAT_STREAM_EVENT_TYPES].sort()).toEqual(
      ['cancelled', 'completed', 'failed', 'started', 'text_delta'].sort(),
    );
  });

  it('declares the stable error code set', () => {
    expect([...CHAT_STREAM_ERROR_CODES].sort()).toEqual(
      [
        'CHAT_INVALID_INPUT',
        'CHAT_OUTPUT_BLOCKED',
        'CHAT_PROVIDER_DOWN',
        'CHAT_RATE_LIMITED',
        'CHAT_TIMEOUT',
        'CHAT_UNKNOWN',
      ].sort(),
    );
  });

  it('restricts ChatService invocations to ai/mixed (U0 migration rule)', () => {
    expect([...CHAT_SOURCE_CHOICES_FOR_INVOCATION].sort()).toEqual(['ai', 'mixed'].sort());
  });

  it('accepts a complete streaming reply (started -> text_delta -> completed)', () => {
    for (const event of FULL_CHAT_STREAM) {
      const parsed = chatStreamEventSchema.parse(event);
      expect(parsed.type).toBe(event.type);
    }
  });

  it('accepts the cancelled terminal event', () => {
    const parsed = chatStreamEventCancelledSchema.parse(CHAT_STREAM_CANCELLED);
    expect(parsed.last_sequence).toBe(0);
    expect(parsed.type).toBe('cancelled');
  });

  it('accepts the failed terminal event with retryable=true', () => {
    const parsed = chatStreamEventFailedSchema.parse(CHAT_STREAM_FAILED);
    expect(parsed.code).toBe('CHAT_TIMEOUT');
    expect(parsed.retryable).toBe(true);
  });

  it('enforces that non-text variants carry sequence = -1', () => {
    expect(() => chatStreamEventStartedSchema.parse(CHAT_STREAM_STARTED)).not.toThrow();
    expect(() => chatStreamEventCompletedSchema.parse(CHAT_STREAM_COMPLETED)).not.toThrow();
    expect(() =>
      chatStreamEventStartedSchema.parse({
        ...CHAT_STREAM_STARTED,
        sequence: 0,
      }),
    ).toThrow();
  });

  it('enforces that text_delta uses monotonically increasing sequence >= 0', () => {
    expect(CHAT_TEXT_DELTA_FIRST.sequence).toBe(0);
    expect(CHAT_TEXT_DELTA_SECOND.sequence).toBe(1);
    const result = chatStreamEventTextDeltaSchema.safeParse(REJECTED_CHAT_DELTA_NEGATIVE_SEQ);
    expect(result.success).toBe(false);
  });

  it('enforces that completed content_hash matches sha256 hex shape', () => {
    const result = chatStreamEventCompletedSchema.safeParse(REJECTED_CHAT_COMPLETED_BAD_HASH);
    expect(result.success).toBe(false);
  });

  it('enforces that completed carries final=true', () => {
    const result = chatStreamEventCompletedSchema.safeParse({
      ...CHAT_STREAM_COMPLETED,
      final: false,
    });
    expect(result.success).toBe(false);
  });

  it('enforces that cancelled last_sequence >= -1 and integer', () => {
    const result = chatStreamEventCancelledSchema.safeParse(REJECTED_CHAT_CANCELLED_BAD_LASTSEQ);
    expect(result.success).toBe(false);
  });

  it('enforces that failed error_message is non-empty and ≤ 2000 chars', () => {
    const result = chatStreamEventFailedSchema.safeParse(REJECTED_CHAT_FAILED_EMPTY_MSG);
    expect(result.success).toBe(false);
  });

  it('rejects a text_delta with empty text', () => {
    const result = chatStreamEventTextDeltaSchema.safeParse(REJECTED_CHAT_DELTA_EMPTY_TEXT);
    expect(result.success).toBe(false);
  });

  it('rejects a chat request with empty user_text', () => {
    const result = chatRequestSchema.safeParse(REJECTED_CHAT_REQUEST_EMPTY);
    expect(result.success).toBe(false);
  });

  it('rejects a chat request with mismatched user_text_chars', () => {
    const result = chatRequestSchema.safeParse(REJECTED_CHAT_REQUEST_CHAR_MISMATCH);
    expect(result.success).toBe(false);
  });

  it('rejects a chat request with source_choice = "human"', () => {
    const result = chatRequestSchema.safeParse(REJECTED_CHAT_REQUEST_HUMAN);
    expect(result.success).toBe(false);
  });

  it('accepts a well-formed chat request', () => {
    const parsed = chatRequestSchema.parse(SUCCESS_CHAT_REQUEST);
    expect(parsed.source_choice).toBe('mixed');
  });

  it('preserves the discriminator on round-trip (chatStreamEventSchema)', () => {
    const parsed = chatStreamEventSchema.parse(CHAT_STREAM_COMPLETED);
    if (parsed.type !== 'completed') throw new Error('type fall-through');
    expect(parsed.content_hash).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    );
    expect(parsed.final).toBe(true);
  });
});
