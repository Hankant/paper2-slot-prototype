import type { EventPayloadMap } from '@contracts';

export type QuestionnairePosition = 'pre' | 'post';
export type QuestionnaireResponseValue = string | number | string[] | null;

export interface QuestionnaireOption {
  readonly value: string;
  readonly label: string;
}

interface QuestionBase {
  readonly id: string;
  readonly prompt: string;
  readonly help?: string;
  readonly required: boolean;
}

export interface ChoiceQuestion extends QuestionBase {
  readonly kind: 'single_choice';
  readonly options: ReadonlyArray<QuestionnaireOption>;
  readonly correctAnswer?: string;
  readonly incorrectFeedback?: string;
}

export interface ScaleQuestion extends QuestionBase {
  readonly kind: 'slider' | 'likert';
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly minLabel: string;
  readonly maxLabel: string;
  readonly valueSuffix?: string;
}

export interface TextQuestion extends QuestionBase {
  readonly kind: 'text';
  readonly multiline?: boolean;
  readonly maxLength: number;
  readonly placeholder?: string;
}

export type QuestionnaireQuestion = ChoiceQuestion | ScaleQuestion | TextQuestion;

export interface QuestionnaireBlock {
  readonly id: string;
  readonly position: QuestionnairePosition;
  readonly title: string;
  readonly eyebrow: string;
  readonly intro?: string;
  readonly submitLabel: string;
  readonly randomizeQuestions?: boolean;
  readonly questions: ReadonlyArray<QuestionnaireQuestion>;
}

export interface QuestionnaireInstrument {
  readonly version: string;
  readonly wordingProfile: 'SELF_AI' | 'HUMAN_AI';
  readonly title: string;
  readonly blocks: ReadonlyArray<QuestionnaireBlock>;
}

export type QuestionnaireBlockPayload = EventPayloadMap['questionnaire_block_submitted'];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`问卷配置错误：${message}`);
}

/** Runtime-check the editable instrument once when the module loads. */
export function defineQuestionnaireInstrument(
  instrument: QuestionnaireInstrument,
): QuestionnaireInstrument {
  assert(instrument.version.trim().length > 0, '缺少 instrument version');
  assert(instrument.blocks.length > 0, '至少需要一个问卷区块');
  const blockIds = new Set<string>();
  const itemIds = new Set<string>();
  for (const block of instrument.blocks) {
    assert(!blockIds.has(block.id), `重复 block id: ${block.id}`);
    blockIds.add(block.id);
    assert(block.questions.length > 0, `${block.id} 没有题目`);
    for (const question of block.questions) {
      assert(!itemIds.has(question.id), `重复 item id: ${question.id}`);
      itemIds.add(question.id);
      assert(question.prompt.trim().length > 0, `${question.id} 缺少题干`);
      if (question.kind === 'single_choice') {
        assert(question.options.length >= 2, `${question.id} 至少需要两个选项`);
        const values = new Set(question.options.map((option) => option.value));
        assert(values.size === question.options.length, `${question.id} 存在重复选项值`);
        if (question.correctAnswer !== undefined)
          assert(values.has(question.correctAnswer), `${question.id} 的正确答案不在选项中`);
      } else if (question.kind === 'slider' || question.kind === 'likert') {
        assert(question.max > question.min, `${question.id} 的量尺上限必须大于下限`);
        assert(question.step > 0, `${question.id} 的步长必须大于 0`);
      } else if (question.kind === 'text') {
        assert(question.maxLength > 0, `${question.id} 的最大长度必须大于 0`);
      }
    }
  }
  return instrument;
}

export function blocksAt(
  instrument: QuestionnaireInstrument,
  position: QuestionnairePosition,
): ReadonlyArray<QuestionnaireBlock> {
  return instrument.blocks.filter((block) => block.position === position);
}
