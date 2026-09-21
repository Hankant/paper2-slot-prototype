import { describe, expect, it } from 'vitest';
import {
  blocksAt,
  defineQuestionnaireInstrument,
  type QuestionnaireInstrument,
} from '../../src/domain/questionnaire.js';
import { QUESTIONNAIRE_INSTRUMENT } from '../../src/domain/questionnaire-instrument-demo.js';

describe('questionnaire instrument configuration', () => {
  it('keeps all editable demo content in one validated instrument', () => {
    expect(QUESTIONNAIRE_INSTRUMENT.wordingProfile).toBe('SELF_AI');
    expect(blocksAt(QUESTIONNAIRE_INSTRUMENT, 'pre').map((block) => block.id)).toEqual([
      'pre-prior-beliefs',
      'pre-comprehension',
    ]);
    expect(blocksAt(QUESTIONNAIRE_INSTRUMENT, 'post')).toHaveLength(4);
    const ids = QUESTIONNAIRE_INSTRUMENT.blocks.flatMap((block) =>
      block.questions.map((question) => question.id),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects duplicate item ids and invalid correct answers', () => {
    const invalid = {
      version: 'test-1.0.0',
      wordingProfile: 'SELF_AI',
      title: 'test',
      blocks: [
        {
          id: 'block',
          position: 'pre',
          eyebrow: 'test',
          title: 'test',
          submitLabel: 'submit',
          questions: [
            {
              id: 'duplicate',
              kind: 'single_choice',
              prompt: 'first',
              required: true,
              correctAnswer: 'missing',
              options: [
                { value: 'a', label: 'A' },
                { value: 'b', label: 'B' },
              ],
            },
          ],
        },
      ],
    } as QuestionnaireInstrument;
    expect(() => defineQuestionnaireInstrument(invalid)).toThrow('正确答案不在选项中');
  });
});
