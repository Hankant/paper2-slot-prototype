import { describe, expect, it } from 'vitest';

import { trialFeedbackSchema } from '../../src/contracts/validators.js';

describe('contracts: trialFeedback (post-R2)', () => {
  it('rejects a circular prerequisite requiring feedback presentation before release', () => {
    expect(
      trialFeedbackSchema.safeParse({
        trial_id: 'trial-001',
        actual_winner_machine_id: 'C',
        participant_predicted_winner: false,
        advice_target_hit: null,
        advice_actual_hit: false,
        points_awarded: 0,
        scoring_version: '0.3.0',
        independent_correct: false,
        final_correct: false,
        required_event_types: ['feedback_presented'],
      }).success,
    ).toBe(false);
  });
  it('accepts a feedback envelope with both independent and final correctness', () => {
    const parsed = trialFeedbackSchema.parse({
      trial_id: 'trial-001',
      actual_winner_machine_id: 'B',
      participant_predicted_winner: true,
      advice_target_hit: true,
      advice_actual_hit: true,
      points_awarded: 10,
      scoring_version: '0.2.0',
      independent_correct: true,
      final_correct: true,
      required_event_types: [
        'prediction_submitted',
        'source_selected',
        'final_prediction_submitted',
      ],
    });
    expect(parsed.actual_winner_machine_id).toBe('B');
    expect(parsed.independent_correct).toBe(true);
    expect(parsed.final_correct).toBe(true);
  });

  it('rejects a feedback envelope with no required_event_types', () => {
    const result = trialFeedbackSchema.safeParse({
      trial_id: 'trial-001',
      actual_winner_machine_id: 'B',
      participant_predicted_winner: true,
      advice_target_hit: null,
      advice_actual_hit: null,
      points_awarded: 0,
      scoring_version: '0.2.0',
      independent_correct: false,
      final_correct: false,
      required_event_types: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-semver scoring_version', () => {
    const result = trialFeedbackSchema.safeParse({
      trial_id: 'trial-001',
      actual_winner_machine_id: 'B',
      participant_predicted_winner: true,
      advice_target_hit: null,
      advice_actual_hit: null,
      points_awarded: 0,
      scoring_version: 'not-a-version',
      independent_correct: false,
      final_correct: false,
      required_event_types: ['prediction_submitted'],
    });
    expect(result.success).toBe(false);
  });
});
