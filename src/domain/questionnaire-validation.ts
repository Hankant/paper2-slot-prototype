import type {
  QuestionnaireInstrument,
  QuestionnaireBlockPayload,
  QuestionnaireQuestion,
  QuestionnaireResponseValue,
} from './questionnaire.js';

export function answerError(
  q: QuestionnaireQuestion,
  value: QuestionnaireResponseValue | undefined,
): string | null {
  const missing =
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  if (missing) return q.required ? '请完成这一题。' : null;
  if (q.kind === 'single_choice') {
    if (typeof value !== 'string' || !q.options.some((o) => o.value === value))
      return '请选择有效选项。';
    if (q.correctAnswer !== undefined && q.correctAnswer !== value)
      return q.incorrectFeedback ?? '请重新检查任务说明。';
  } else if (q.kind === 'text') {
    if (typeof value !== 'string' || value.length > q.maxLength) return '文字长度或格式不正确。';
  } else if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < q.min ||
    value > q.max ||
    Math.abs((value - q.min) / q.step - Math.round((value - q.min) / q.step)) > 1e-8
  )
    return '数值超出量表范围或步长不正确。';
  return null;
}

/** Validate against the actual instrument, not just the generic JSON envelope. */
export function validateQuestionnaireSubmission(
  instrument: QuestionnaireInstrument,
  payload: QuestionnaireBlockPayload,
): void {
  const block = instrument.blocks.find((b) => b.id === payload.block_id);
  if (
    !block ||
    payload.instrument_version !== instrument.version ||
    payload.wording_profile !== instrument.wordingProfile ||
    payload.position !== block.position
  )
    throw new Error('问卷版本或区块不匹配');
  const ids = block.questions.map((q) => q.id);
  const sameSet = (items: string[]) =>
    items.length === ids.length &&
    new Set(items).size === ids.length &&
    items.every((id) => ids.includes(id));
  if (!sameSet(payload.item_order) || !sameSet(payload.responses.map((r) => r.item_id)))
    throw new Error('问卷存在缺题、重复题或未知题目');
  if (!block.randomizeQuestions && payload.item_order.some((id, i) => id !== ids[i]))
    throw new Error('题目呈现顺序不匹配');
  for (const q of block.questions) {
    const response = payload.responses.find((r) => r.item_id === q.id);
    if (!response) throw new Error('缺少作答');
    const missing =
      response.value === null || (typeof response.value === 'string' && !response.value.trim());
    if (missing !== response.skipped || (response.skipped && response.value !== null))
      throw new Error('跳过标记与答案不一致');
    const error = answerError(q, response.value);
    if (error) throw new Error(`${q.id}: ${error}`);
  }
  const errors = payload.comprehension_errors ?? [];
  if (
    new Set(errors.map((e) => e.item_id)).size !== errors.length ||
    errors.some(
      (e) =>
        !block.questions.some(
          (q) => q.id === e.item_id && q.kind === 'single_choice' && q.correctAnswer !== undefined,
        ),
    )
  )
    throw new Error('理解检验错误计数包含未知题目或重复题目');
}
