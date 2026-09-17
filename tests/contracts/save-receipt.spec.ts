import { describe, expect, it } from 'vitest';

import { saveReceiptSchema } from '../../src/contracts/validators.js';
import {
  PARTIAL_SAVE_RECEIPT,
  REJECTED_SAVE_RECEIPT,
  SUCCESS_SAVE_RECEIPT,
  UNCONFIRMED_SAVE_RECEIPT,
} from '../fixtures/session-fixtures.js';

describe('contracts: saveReceipt (4 classes required by G0 acceptance, post-R3 refine)', () => {
  it('class 1 — success: persistence_scope=remote, no rejections, no unconfirmed', () => {
    const parsed = saveReceiptSchema.parse(SUCCESS_SAVE_RECEIPT);
    expect(parsed.persistence_scope).toBe('remote');
    expect(parsed.acknowledged_event_ids).toHaveLength(1);
    expect(parsed.rejected_events).toHaveLength(0);
    expect(parsed.unconfirmed_event_ids).toHaveLength(0);
    expect(parsed.persisted_at).not.toBeNull();
    expect(parsed.receipt_id).not.toBeNull();
  });

  it('class 2 — rejection: receipt carries rejected_events with explicit reason', () => {
    const parsed = saveReceiptSchema.parse(PARTIAL_SAVE_RECEIPT);
    expect(parsed.rejected_events).toHaveLength(1);
    const rejection = parsed.rejected_events[0];
    expect(rejection?.reason_code).toBe('OUT_OF_ORDER');
    expect(rejection?.event_id).toBe('22222222-2222-4222-8222-222222222222');
    expect(parsed.acknowledged_event_ids).toContain('11111111-1111-4111-8111-111111111111');
  });

  it('class 3 — partial: acknowledged and rejected coexist', () => {
    const parsed = saveReceiptSchema.parse(PARTIAL_SAVE_RECEIPT);
    expect(parsed.acknowledged_event_ids.length).toBeGreaterThan(0);
    expect(parsed.rejected_events.length).toBeGreaterThan(0);
  });

  it('class 4 — unconfirmed: scope=memory, no persisted_at, no receipt_id', () => {
    const parsed = saveReceiptSchema.parse(UNCONFIRMED_SAVE_RECEIPT);
    expect(parsed.persistence_scope).toBe('memory');
    expect(parsed.persisted_at).toBeNull();
    expect(parsed.receipt_id).toBeNull();
    expect(parsed.unconfirmed_event_ids.length).toBeGreaterThan(0);
  });

  it('rejects receipt whose acknowledged_event_ids are not uuids', () => {
    const result = saveReceiptSchema.safeParse(REJECTED_SAVE_RECEIPT);
    expect(result.success).toBe(false);
  });

  it('rejects remote receipt lacking persisted_at OR receipt_id (post-R3)', () => {
    const withoutTimestamp = saveReceiptSchema.safeParse({
      ...SUCCESS_SAVE_RECEIPT,
      persisted_at: null,
    });
    const withoutReceiptId = saveReceiptSchema.safeParse({
      ...SUCCESS_SAVE_RECEIPT,
      receipt_id: null,
    });
    expect(withoutTimestamp.success).toBe(false);
    expect(withoutReceiptId.success).toBe(false);
  });

  it('rejects non-remote receipt that carries persisted_at OR receipt_id (post-R3)', () => {
    const leakedTimestamp = saveReceiptSchema.safeParse({
      ...UNCONFIRMED_SAVE_RECEIPT,
      persisted_at: '2026-09-17T14:00:00.000Z',
    });
    const leakedReceiptId = saveReceiptSchema.safeParse({
      ...UNCONFIRMED_SAVE_RECEIPT,
      receipt_id: 'rcpt-leak',
    });
    expect(leakedTimestamp.success).toBe(false);
    expect(leakedReceiptId.success).toBe(false);
  });

  it('rejects an event_id that appears in both acknowledged and rejected sets (post-R3)', () => {
    const result = saveReceiptSchema.safeParse({
      ...SUCCESS_SAVE_RECEIPT,
      rejected_events: [
        {
          event_id: SUCCESS_SAVE_RECEIPT.acknowledged_event_ids[0] as string,
          reason_code: 'INVALID_EVENT',
          reason_message: 'review conflict',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects receipt whose event-id lists are internally non-unique', () => {
    const duplicateAck = saveReceiptSchema.safeParse({
      ...SUCCESS_SAVE_RECEIPT,
      acknowledged_event_ids: [
        ...SUCCESS_SAVE_RECEIPT.acknowledged_event_ids,
        ...SUCCESS_SAVE_RECEIPT.acknowledged_event_ids,
      ],
    });
    expect(duplicateAck.success).toBe(false);
  });
});
