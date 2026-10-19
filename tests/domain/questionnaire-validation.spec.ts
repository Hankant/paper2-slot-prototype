import { expect, it } from 'vitest';
import { QUESTIONNAIRE_INSTRUMENT as instrument } from '../../src/domain/questionnaire-instrument-demo.js';
import { validateQuestionnaireSubmission } from '../../src/domain/questionnaire-validation.js';
import type { QuestionnaireBlockPayload } from '../../src/domain/questionnaire.js';

function payload(id = 'pre-prior-beliefs'): QuestionnaireBlockPayload {
  const block = instrument.blocks.find((b) => b.id === id)!;
  return {
    block_id: id,
    position: block.position,
    instrument_version: instrument.version,
    wording_profile: instrument.wordingProfile,
    item_order: block.questions.map((q) => q.id),
    responses: block.questions.map((q) => ({
      item_id: q.id,
      value:
        q.kind === 'single_choice'
          ? (q.correctAnswer ?? q.options[0]!.value)
          : q.kind === 'text'
            ? 'answer'
            : q.min,
      skipped: false,
      response_ms: 100,
    })),
  };
}
it('validates all published blocks against actual questions', () => {
  for (const block of instrument.blocks)
    expect(() => validateQuestionnaireSubmission(instrument, payload(block.id))).not.toThrow();
});
it.each([
  'missing',
  'unknown',
  'duplicate',
  'out-of-range',
  'skip',
  'wrong-option',
  'wrong-comprehension',
  'foreign-counter',
  'wrong-version',
])('rejects %s questionnaire data', (fault) => {
  const p = payload(
    fault === 'wrong-option' || fault === 'wrong-comprehension'
      ? 'pre-comprehension'
      : 'pre-prior-beliefs',
  );
  if (fault === 'missing') p.responses.pop();
  if (fault === 'unknown') p.responses[0]!.item_id = 'not-a-question';
  if (fault === 'duplicate') p.responses[1] = p.responses[0]!;
  if (fault === 'out-of-range') p.responses[0]!.value = 101;
  if (fault === 'skip') p.responses[0]!.skipped = true;
  if (fault === 'wrong-option') p.responses[0]!.value = 'invented';
  if (fault === 'wrong-comprehension') p.responses[0]!.value = 'historical_best';
  if (fault === 'foreign-counter')
    p.comprehension_errors = [{ item_id: 'PRE_PRIOR_ACC_SELF', incorrect_count: 1 }];
  if (fault === 'wrong-version') p.instrument_version = 'wrong';
  expect(() => validateQuestionnaireSubmission(instrument, p)).toThrow();
});
