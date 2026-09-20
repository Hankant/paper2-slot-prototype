/**
 * Chat-stream consumer/verifier tests (R5 fix).
 *
 * Schema-level tests in `chat-events.spec.ts` cover field validity; these
 * tests drive `verifyChatStream` against crafted event sequences to enforce
 * the streaming invariants that an implementation could otherwise fail to
 * honor (out-of-order sequence, repeated started, duplicate terminal,
 * cross-request smuggling, hash mismatch, content-hash recompute).
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { ChatStreamEventInput } from '../../src/contracts/index.js';
import { CHAT_MESSAGE_META, FIXTURE_CHAT_IDS } from '../fixtures/chat-fixtures.js';

import {
  delayedEvents,
  fixedEvents,
  type ParsedStreamEvent,
  verifyChatStream,
} from './_helpers/chat-stream-harness.js';

const REQ = FIXTURE_CHAT_IDS.requestId;
const OTHER_REQ = FIXTURE_CHAT_IDS.requestId2;

const sha256Of = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const baseEvent = {
  event_id: '11111111-1111-4111-8111-111111111111',
  schema_version: '0.3.0',
  contract_version: '0.3.0',
  client_version: '0.3.0',
  material_version: '0.3.0',
  protocol_version: 'unreleased',
  request_id: REQ,
  message_meta: CHAT_MESSAGE_META,
  server_timestamp: '2026-09-18T12:00:00.000Z',
} as const;

describe('chat-stream harness (R5 fix)', () => {
  it('accepts a happy-path stream and recomputes the content_hash', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'hello ',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 1,
        text: 'world',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of('hello world'),
        total_text_deltas: 2,
        final: true,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(true);
    expect(result.acknowledged_deltas).toBe(2);
    expect(result.computed_text_hash).toBe(sha256Of('hello world'));
    expect(result.observed_terminal_type).toBe('completed');
  });

  it('rejects non-monotonic text_delta sequence (goes backward)', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'a',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 1,
        text: 'b',
        author: 'assistant',
      },
      {
        ...baseEvent,
        // 故意退回 seq=0 — 重放或缓存导致的乱序
        type: 'text_delta',
        sequence: 0,
        text: 'c',
        author: 'assistant',
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_UNKNOWN');
    expect(result.failure_reason).toMatch(/not greater than/i);
  });

  it('rejects duplicate started events', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      { ...baseEvent, type: 'started', sequence: -1 },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_UNKNOWN');
    expect(result.failure_reason).toMatch(/repeated started/i);
  });

  it('rejects text_delta arriving before started', async () => {
    const events: ChatStreamEventInput[] = [
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'orphan',
        author: 'assistant',
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_UNKNOWN');
    expect(result.failure_reason).toMatch(/before started/i);
  });

  it('rejects multiple terminal events', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'cancelled',
        sequence: -1,
        last_sequence: 0,
      },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of(''),
        total_text_deltas: 0,
        final: true,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_UNKNOWN');
    expect(result.failure_reason).toMatch(/multiple terminal/i);
  });

  it('rejects stream that never emits a terminal event', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: '...',
        author: 'assistant',
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_UNKNOWN');
    expect(result.failure_reason).toMatch(/without a terminal/i);
  });

  it('rejects cross-request_id contamination', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        request_id: OTHER_REQ,
        type: 'text_delta',
        sequence: 0,
        text: 'wrong request id',
        author: 'assistant',
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_INVALID_INPUT');
    expect(result.failure_reason).toMatch(/request_id|cross-request|unexpected/i);
  });

  it('detects content_hash mismatch when text is tampered', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'tampered',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of('untampered'),
        total_text_deltas: 1,
        final: true,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_PROVIDER_DOWN');
    expect(result.failure_reason).toMatch(/hash mismatch/i);
    expect(result.computed_text_hash).toBe(sha256Of('tampered'));
  });

  it('accepts zero-len empty text via started + completed only', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of(''),
        total_text_deltas: 0,
        final: true,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(true);
    expect(result.acknowledged_deltas).toBe(0);
  });

  it('recognises the cancelled terminal and exposes last_sequence consumers can replay', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'partial',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 1,
        text: ' answer',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'cancelled',
        sequence: -1,
        last_sequence: 1,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(true);
    expect(result.observed_terminal_type).toBe('cancelled');
    expect(result.acknowledged_deltas).toBe(2);
  });

  it('rejects a stream whose first event is not parseable (CHAT_INVALID_INPUT)', async () => {
    const events: Array<unknown> = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'completed',
        // deliberately bad content_hash
        content_hash: 'not-a-sha256-hex',
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(false);
    expect(result.failure_code).toBe('CHAT_INVALID_INPUT');
  });

  it('preserves chronological event order in observed events', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 0,
        text: 'a',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'text_delta',
        sequence: 1,
        text: 'b',
        author: 'assistant',
      },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of('ab'),
        total_text_deltas: 2,
        final: true,
      },
    ];
    const result = await verifyChatStream(fixedEvents(events), REQ);
    expect(result.ok).toBe(true);
    expect(result.events.map((e: ParsedStreamEvent) => e.type)).toEqual([
      'started',
      'text_delta',
      'text_delta',
      'completed',
    ]);
    expect(result.events.map((e: ParsedStreamEvent) => e.sequence)).toEqual([-1, 0, 1, -1]);
  });

  it('honours zero-delay in delayedEvents helper and still terminates', async () => {
    const events: ChatStreamEventInput[] = [
      { ...baseEvent, type: 'started', sequence: -1 },
      {
        ...baseEvent,
        type: 'completed',
        sequence: -1,
        content_hash: sha256Of(''),
        total_text_deltas: 0,
        final: true,
      },
    ];
    const result = await verifyChatStream(
      delayedEvents(events, () => 0),
      REQ,
    );
    expect(result.ok).toBe(true);
  });
});
