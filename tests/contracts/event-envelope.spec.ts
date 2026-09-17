import { describe, expect, it } from 'vitest';

import { eventEnvelopeSchema } from '../../src/contracts/validators.js';

describe('contracts: event envelope (post-R1)', () => {
  const trialEnvelope = {
    schema_version: '0.2.0',
    contract_version: '0.2.0',
    protocol_version: 'unreleased',
    material_version: '0.2.0',
    client_version: '0.2.0',
    session_id: 'sess-fixture-success',
    participant_id: 'part-fixture-success',
    event_id: '11111111-1111-4111-8111-111111111111',
    sequence_no: 0,
    trial_id: 'trial-001',
    phase: 'calibration' as const,
    event_type: 'prediction_submitted' as const,
    client_timestamp: '2026-09-17T14:00:00.000Z',
    elapsed_ms: 1234,
  };

  const entryEnvelope = {
    schema_version: '0.2.0',
    contract_version: '0.2.0',
    protocol_version: 'unreleased',
    material_version: '0.2.0',
    client_version: '0.2.0',
    session_id: 'sess-fixture-success',
    participant_id: 'part-fixture-success',
    event_id: '22222222-2222-4222-8222-222222222222',
    sequence_no: 0,
    phase: 'entry' as const,
    event_type: 'consent_recorded' as const,
    client_timestamp: '2026-09-17T14:00:00.000Z',
    elapsed_ms: 1234,
  };

  it('accepts a complete prediction envelope with payload', () => {
    const parsed = eventEnvelopeSchema.parse({
      ...trialEnvelope,
      payload: {
        machine_id: 'B',
        display_position: 'center' as const,
        elapsed_ms: 1234,
      },
    });
    expect(parsed.sequence_no).toBe(0);
    expect(parsed.payload).toEqual({
      machine_id: 'B',
      display_position: 'center',
      elapsed_ms: 1234,
    });
  });

  it('round-trips the payload field untouched', () => {
    const payload = {
      machine_id: 'B',
      display_position: 'center' as const,
      elapsed_ms: 1,
    };
    const parsed = eventEnvelopeSchema.parse({ ...trialEnvelope, payload });
    expect(parsed.payload).toBe(payload);
  });

  it('rejects a prediction event without payload', () => {
    const result = eventEnvelopeSchema.safeParse({ ...trialEnvelope, payload: undefined });
    expect(result.success).toBe(false);
  });

  it('rejects a prediction event without trial_id', () => {
    const { trial_id: _trialId, ...withoutTrial } = trialEnvelope;
    void _trialId;
    const result = eventEnvelopeSchema.safeParse({
      ...withoutTrial,
      payload: {
        machine_id: 'B',
        display_position: 'center' as const,
        elapsed_ms: 1,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid event_id', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...trialEnvelope,
      event_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative elapsed_ms on the envelope', () => {
    const result = eventEnvelopeSchema.safeParse({ ...trialEnvelope, elapsed_ms: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown event_type', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...trialEnvelope,
      event_type: 'hacker_event',
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence_submitted payload with confidence_percent > 100', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...trialEnvelope,
      event_type: 'confidence_submitted',
      payload: { confidence_percent: 150 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts confidence_submitted payload within 0..100', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...trialEnvelope,
      event_type: 'confidence_submitted',
      payload: { confidence_percent: 50 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts entry-level consent_recorded without trial_id', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...entryEnvelope,
      payload: { version: 'paper2/0.2.0' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects entry-level consent_recorded that carries trial_id', () => {
    const result = eventEnvelopeSchema.safeParse({
      ...entryEnvelope,
      trial_id: 'trial-001',
      payload: { version: 'paper2/0.2.0' },
    });
    expect(result.success).toBe(false);
  });
});
