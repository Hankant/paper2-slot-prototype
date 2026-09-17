import { describe, expect, it } from 'vitest';
import demo from '../../config/demo.json';
import {
  capabilitiesSchema,
  eventEnvelopeSchema,
  publicTrialSchema,
  satisfiesRequired,
} from '../../src/contracts/index.js';
import { SUCCESS_PUBLIC_TRIAL } from '../../tests/fixtures/session-fixtures.js';

const base = {
  schema_version: '0.2.0',
  contract_version: '0.2.0',
  protocol_version: 'unreleased',
  material_version: '0.2.0',
  client_version: '0.2.0',
  session_id: 'revision-review-session',
  participant_id: 'revision-review-participant',
  event_id: '11111111-1111-4111-8111-111111111111',
  sequence_no: 0,
  client_timestamp: '2026-09-17T16:00:00.000Z',
  elapsed_ms: 1000,
};

describe('G0 revision: integration contract probes', () => {
  it('can parse an honest LocalDemo capability declaration before applying production admission', () => {
    expect(
      capabilitiesSchema.safeParse({
        provider: demo.provider,
        adapter_version: demo.adapter_version,
        capabilities: demo.capabilities,
      }).success,
    ).toBe(true);
  });

  it('does not expose the target or advice text in an unrevealed public advice block', () => {
    const result = publicTrialSchema.safeParse({
      ...SUCCESS_PUBLIC_TRIAL,
      advice_timing: 'after_choice',
      advice: {
        advice_id: 'review-hidden-advice',
        advice_target_machine_id: 'B',
        advice_target_display_position: 'center',
        copy: '选择机器 B',
        revealed: false,
      },
    });
    // Either reject the unsafe wire shape or remove unrevealed information.
    if (result.success) {
      expect(result.data.advice).not.toHaveProperty('advice_target_machine_id');
      expect(result.data.advice).not.toHaveProperty('copy');
    }
  });

  it('accepts a comprehension response in instructions before any trial exists', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...base,
        phase: 'instructions',
        event_type: 'comprehension_answered',
        payload: { question_id: 'instructions-q1', answer: 'actual-winner', correct: true },
      }).success,
    ).toBe(true);
  });

  it('accepts a visibility event on the consent page without fabricating a trial ID', () => {
    expect(
      eventEnvelopeSchema.safeParse({
        ...base,
        phase: 'consent',
        event_type: 'visibility_changed',
        payload: { element_id: 'document', visible: false },
      }).success,
    ).toBe(true);
  });

  it('control: still rejects LocalDemo as a production backend', () => {
    expect(satisfiesRequired(demo.capabilities)).toBe(false);
  });

  it('control: still accepts a normal prediction payload intact', () => {
    const payload = { machine_id: 'A', display_position: 'left' };
    const result = eventEnvelopeSchema.parse({
      ...base,
      phase: 'main',
      trial_id: 'trial-001',
      event_type: 'prediction_submitted',
      payload,
    });
    expect(result.payload).toEqual(payload);
  });
});
