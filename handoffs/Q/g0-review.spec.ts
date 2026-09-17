import { describe, expect, it, vi, afterEach } from 'vitest';
import rawDemo from '../../config/demo.json';
import {
  eventEnvelopeSchema,
  saveReceiptSchema,
  publicTrialSchema,
  satisfiesRequired,
} from '../../src/contracts/index.js';
import {
  SUCCESS_SAVE_RECEIPT,
  SUCCESS_PUBLIC_TRIAL,
  VALID_CAPABILITIES,
} from '../../tests/fixtures/session-fixtures.js';

// Independent acceptance probes, not a repair to the implementation.
const prediction = {
  schema_version: '0.1.0',
  contract_version: '0.1.0',
  protocol_version: 'unreleased',
  material_version: '0.1.0',
  client_version: '0.1.0',
  session_id: 'review-session',
  participant_id: 'review-participant',
  event_id: '11111111-1111-4111-8111-111111111111',
  sequence_no: 1,
  trial_id: 'trial-001',
  phase: 'main',
  event_type: 'prediction_submitted',
  client_timestamp: '2026-09-17T14:00:00.000Z',
  elapsed_ms: 1000,
  payload: { machine_id: 'B', display_position: 'center' },
};

describe('Independent G0 review: required data semantics', () => {
  it('preserves the participant response payload when validating an event', () => {
    expect(eventEnvelopeSchema.parse(prediction)).toHaveProperty('payload', prediction.payload);
  });

  it('rejects a prediction with no response payload', () => {
    const { payload: _payload, ...withoutResponse } = prediction;
    expect(eventEnvelopeSchema.safeParse(withoutResponse).success).toBe(false);
  });

  it('rejects a trial prediction with no trial ID', () => {
    const { trial_id: _trialId, ...withoutTrial } = prediction;
    expect(eventEnvelopeSchema.safeParse(withoutTrial).success).toBe(false);
  });

  it('rejects confidence outside the documented 0-100 range', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...prediction,
        event_type: 'confidence_submitted',
        payload: { confidence_percent: 150 },
      }).success,
    ).toBe(false);
  });

  it('rejects remote acknowledgement without server confirmation metadata', () => {
    expect(
      saveReceiptSchema.safeParse({
        ...SUCCESS_SAVE_RECEIPT,
        persisted_at: null,
        receipt_id: null,
      }).success,
    ).toBe(false);
  });

  it('rejects an event acknowledged and rejected in the same receipt', () => {
    expect(
      saveReceiptSchema.safeParse({
        ...SUCCESS_SAVE_RECEIPT,
        rejected_events: [
          {
            event_id: SUCCESS_SAVE_RECEIPT.acknowledged_event_ids[0],
            reason_code: 'INVALID_EVENT',
            reason_message: 'review conflict',
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a production capability set with no persistent result storage', () => {
    expect(
      satisfiesRequired({
        ...VALID_CAPABILITIES.capabilities,
        persistentResults: 'unsupported',
      }),
    ).toBe(false);
  });

  it('rejects repeated machine IDs and display positions', () => {
    const machine = SUCCESS_PUBLIC_TRIAL.machines[0];
    expect(
      publicTrialSchema.safeParse({
        ...SUCCESS_PUBLIC_TRIAL,
        machines: [machine, machine, machine],
      }).success,
    ).toBe(false);
  });

  it('control: accepts the existing valid remote receipt', () => {
    expect(saveReceiptSchema.safeParse(SUCCESS_SAVE_RECEIPT).success).toBe(true);
  });

  it('control: rejects an impossible history hit rate', () => {
    expect(
      publicTrialSchema.safeParse({
        ...SUCCESS_PUBLIC_TRIAL,
        visible_history: [{ trial_id: 'history-1', machine_id: 'A', observed_hit_rate: 2 }],
      }).success,
    ).toBe(false);
  });
});

describe('Independent G0 review: demo configuration boundary', () => {
  afterEach(() => {
    vi.doUnmock('../../config/demo.json');
    vi.resetModules();
  });

  it('rejects negative trial counts at the configuration boundary', async () => {
    vi.resetModules();
    vi.doMock('../../config/demo.json', () => ({
      default: { ...rawDemo, phase_trial_counts: { practice: 3, calibration: 6, main: -12 } },
    }));
    await expect(import('../../config/demo.js')).rejects.toThrow();
  });

  it('rejects contradictory no-real-data flags rather than rewriting them to true', async () => {
    vi.resetModules();
    vi.doMock('../../config/demo.json', () => ({
      default: {
        ...rawDemo,
        personal_data: { ...rawDemo.personal_data, no_real_personal_data: false },
      },
    }));
    await expect(import('../../config/demo.js')).rejects.toThrow();
  });
});
