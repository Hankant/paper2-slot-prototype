/**
 * Fixed chat fixtures for U0 contract acceptance tests.
 *
 * These are intentionally hand-written so reviewers can audit them. They are
 * NOT real participant data. Numbers and ids are UUID v4 placeholders, not
 * from any deployed study.
 */

import type {
  ChatRequest,
  ChatRequestInput,
  ChatStreamEvent,
  ChatStreamEventStarted,
  ChatStreamEventTextDelta,
  ChatStreamEventCompleted,
  ChatStreamEventCancelled,
  ChatStreamEventFailed,
} from '../../src/contracts/index.js';

const FIXTURE_REQ_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FIXTURE_MESSAGE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FIXTURE_EVENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FIXTURE_REQ_ID_2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// 64-char lowercase hex; sha256('hello world\n')
const FIXTURE_CONTENT_HASH = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';

export const FIXTURE_CHAT_IDS = {
  requestId: FIXTURE_REQ_ID,
  requestId2: FIXTURE_REQ_ID_2,
  messageId: FIXTURE_MESSAGE_ID,
  eventId: FIXTURE_EVENT_ID,
} as const;

export const SUCCESS_CHAT_REQUEST: ChatRequest = {
  session_id: 'sess-fixture-success',
  trial_id: 'trial-001',
  advice_id: 'advice-001',
  request_id: FIXTURE_REQ_ID,
  user_text: 'Confirm recent performance',
  source_choice: 'mixed',
  locale: 'en-US',
  user_text_chars: 26,
  client_versions: {
    contract_version: '0.3.0',
    material_version: '0.3.0',
    client_version: '0.3.0',
    protocol_version: 'unreleased',
  },
};

export const CHAT_MESSAGE_META = {
  message_id: FIXTURE_MESSAGE_ID,
  request_id: FIXTURE_REQ_ID,
  author: 'assistant' as const,
  opened_at: '2026-09-18T12:00:00.000Z',
  adapter_version: 'local-demo/0.4.0-rc',
};

export const CHAT_STREAM_STARTED: ChatStreamEventStarted = {
  event_id: FIXTURE_EVENT_ID,
  schema_version: '0.3.0',
  contract_version: '0.3.0',
  client_version: '0.3.0',
  material_version: '0.3.0',
  protocol_version: 'unreleased',
  request_id: FIXTURE_REQ_ID,
  message_meta: CHAT_MESSAGE_META,
  sequence: -1,
  server_timestamp: '2026-09-18T12:00:00.100Z',
  type: 'started',
};

export const CHAT_TEXT_DELTA_FIRST: ChatStreamEventTextDelta = {
  ...CHAT_STREAM_STARTED,
  sequence: 0,
  text: '这台机器最近 ',
  author: 'assistant',
  type: 'text_delta',
  server_timestamp: '2026-09-18T12:00:00.200Z',
};

export const CHAT_TEXT_DELTA_SECOND: ChatStreamEventTextDelta = {
  ...CHAT_STREAM_STARTED,
  event_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  sequence: 1,
  text: '5 次中有 2 次命中，命中率约 40%。',
  author: 'assistant',
  type: 'text_delta',
  server_timestamp: '2026-09-18T12:00:00.300Z',
};

export const CHAT_STREAM_COMPLETED: ChatStreamEventCompleted = {
  ...CHAT_STREAM_STARTED,
  event_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  sequence: -1,
  content_hash: FIXTURE_CONTENT_HASH,
  total_text_deltas: 2,
  final: true,
  type: 'completed',
  server_timestamp: '2026-09-18T12:00:00.400Z',
};

export const CHAT_STREAM_CANCELLED: ChatStreamEventCancelled = {
  ...CHAT_STREAM_STARTED,
  event_id: '12121212-1212-4122-8122-121212121212',
  sequence: -1,
  last_sequence: 0,
  type: 'cancelled',
  server_timestamp: '2026-09-18T12:00:00.250Z',
};

export const CHAT_STREAM_FAILED: ChatStreamEventFailed = {
  ...CHAT_STREAM_STARTED,
  event_id: '13131313-1313-4133-8133-131313131313',
  sequence: -1,
  code: 'CHAT_TIMEOUT',
  retryable: true,
  error_message: '服务端在 30 秒内未产出首个 text_delta',
  type: 'failed',
  server_timestamp: '2026-09-18T12:00:30.500Z',
};

export const FULL_CHAT_STREAM: ReadonlyArray<ChatStreamEvent> = [
  CHAT_STREAM_STARTED,
  CHAT_TEXT_DELTA_FIRST,
  CHAT_TEXT_DELTA_SECOND,
  CHAT_STREAM_COMPLETED,
];

/** Deliberately invalid: empty user_text (rejected by chatRequestSchema). */
export const REJECTED_CHAT_REQUEST_EMPTY: ChatRequestInput = {
  ...SUCCESS_CHAT_REQUEST,
  user_text: '',
  user_text_chars: 0,
};

/** Deliberately invalid: user_text_chars mismatch user_text.length. */
export const REJECTED_CHAT_REQUEST_CHAR_MISMATCH: ChatRequestInput = {
  ...SUCCESS_CHAT_REQUEST,
  user_text_chars: 1,
};

/** Deliberately invalid: source_choice is 'human' (CHAT service rejects). */
export const REJECTED_CHAT_REQUEST_HUMAN: ChatRequestInput = {
  ...SUCCESS_CHAT_REQUEST,
  source_choice: 'human',
};

/** Deliberately invalid: text_delta with negative sequence. */
export const REJECTED_CHAT_DELTA_NEGATIVE_SEQ: ChatStreamEventTextDelta = {
  ...CHAT_TEXT_DELTA_FIRST,
  sequence: -1,
};

/** Deliberately invalid: completed missing content_hash sha256 shape. */
export const REJECTED_CHAT_COMPLETED_BAD_HASH: ChatStreamEventCompleted = {
  ...CHAT_STREAM_COMPLETED,
  content_hash: 'not-a-sha256',
};

/** Deliberately invalid: cancelled with non-integer last_sequence. */
export const REJECTED_CHAT_CANCELLED_BAD_LASTSEQ: ChatStreamEventCancelled = {
  ...CHAT_STREAM_CANCELLED,
  last_sequence: 1.5 as unknown as number,
};

/** Deliberately invalid: failed with empty error_message. */
export const REJECTED_CHAT_FAILED_EMPTY_MSG: ChatStreamEventFailed = {
  ...CHAT_STREAM_FAILED,
  error_message: '',
};

/** Deliberately invalid: text_delta with empty text. */
export const REJECTED_CHAT_DELTA_EMPTY_TEXT: ChatStreamEventTextDelta = {
  ...CHAT_TEXT_DELTA_FIRST,
  text: '',
};
