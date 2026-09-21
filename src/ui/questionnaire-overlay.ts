import type {
  QuestionnaireBlock,
  QuestionnaireBlockPayload,
  QuestionnaireInstrument,
  QuestionnairePosition,
  QuestionnaireQuestion,
  QuestionnaireResponseValue,
} from '../domain/questionnaire.js';
import { blocksAt } from '../domain/questionnaire.js';
import { requireElement } from './atelier/dom.js';
import './questionnaire.css';

export interface QuestionnaireMountOptions {
  readonly isSubmitted: (blockId: string) => boolean;
  readonly submit: (payload: QuestionnaireBlockPayload) => Promise<void>;
}

function shuffled<T>(values: ReadonlyArray<T>): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

function renderScale(question: Extract<QuestionnaireQuestion, { kind: 'slider' | 'likert' }>) {
  if (question.kind === 'slider') {
    const midpoint = Math.round((question.min + question.max) / 2);
    return `<div class="questionnaire-slider-wrap"><div class="questionnaire-slider-value" data-value-for="${question.id}">尚未作答</div><input type="range" min="${question.min}" max="${question.max}" step="${question.step}" value="${midpoint}" data-question-id="${question.id}" aria-label="${question.prompt}"><div class="questionnaire-scale-labels"><span>${question.minLabel}</span><span>${question.maxLabel}</span></div></div>`;
  }
  const values: number[] = [];
  for (let value = question.min; value <= question.max; value += question.step) values.push(value);
  return `<div class="questionnaire-likert"><span>${question.minLabel}</span><div class="questionnaire-likert-options">${values.map((value) => `<label><input type="radio" name="${question.id}" value="${value}" data-question-id="${question.id}"><b>${value}</b></label>`).join('')}</div><span>${question.maxLabel}</span></div>`;
}

function renderQuestion(question: QuestionnaireQuestion, index: number): string {
  let control = '';
  if (question.kind === 'single_choice') {
    control = `<div class="questionnaire-choices">${question.options.map((option) => `<label><input type="radio" name="${question.id}" value="${option.value}" data-question-id="${question.id}"><span>${option.label}</span></label>`).join('')}</div>`;
  } else if (question.kind === 'slider' || question.kind === 'likert') {
    control = renderScale(question);
  } else if (question.kind === 'text') {
    const common = `data-question-id="${question.id}" maxlength="${question.maxLength}" placeholder="${question.placeholder ?? ''}"`;
    control = question.multiline
      ? `<textarea ${common} rows="4"></textarea>`
      : `<input type="text" ${common}>`;
  }
  return `<fieldset class="questionnaire-item" data-item-id="${question.id}"><legend><span>${String(index + 1).padStart(2, '0')}</span>${question.prompt}${question.required ? '<em>必答</em>' : '<em>选答</em>'}</legend>${question.help ? `<p>${question.help}</p>` : ''}${control}<div class="questionnaire-item-error" role="alert"></div></fieldset>`;
}

async function mountBlock(
  root: HTMLElement,
  instrument: QuestionnaireInstrument,
  block: QuestionnaireBlock,
  submit: (payload: QuestionnaireBlockPayload) => Promise<void>,
): Promise<void> {
  const questions = block.randomizeQuestions ? shuffled(block.questions) : [...block.questions];
  const shownAt = performance.now();
  const answeredAt = new Map<string, number>();
  const values = new Map<string, QuestionnaireResponseValue>();
  const overlay = document.createElement('section');
  overlay.className = 'questionnaire-overlay';
  overlay.dataset.blockId = block.id;
  overlay.setAttribute('aria-label', instrument.title);
  overlay.innerHTML = `<div class="questionnaire-shell"><header><a class="wordmark" href="./index.html"><span class="brand-mark">p.</span> PREDICTION LAB</a><span>研究问卷</span></header><main><p class="eyebrow">${block.eyebrow}</p><h1>${block.title}</h1>${block.intro ? `<p class="questionnaire-intro">${block.intro}</p>` : ''}<form novalidate><div class="questionnaire-items">${questions.map(renderQuestion).join('')}</div><p class="questionnaire-form-error" role="alert"></p><button type="submit" class="primary">${block.submitLabel}<span>→</span></button></form></main><footer>题项版本 ${instrument.version} · ${instrument.wordingProfile}</footer></div>`;
  root.append(overlay);

  const setValue = (id: string, value: QuestionnaireResponseValue): void => {
    values.set(id, value);
    answeredAt.set(id, Math.max(0, Math.round(performance.now() - shownAt)));
    requireElement<HTMLElement>(overlay, `[data-item-id="${id}"]`).classList.remove('invalid');
    requireElement<HTMLElement>(
      overlay,
      `[data-item-id="${id}"] .questionnaire-item-error`,
    ).textContent = '';
  };
  overlay.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
    input.addEventListener('change', () => setValue(input.dataset.questionId ?? '', input.value));
  });
  overlay.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
    input.addEventListener('input', () => {
      const id = input.dataset.questionId ?? '';
      const question = questions.find((item) => item.id === id);
      setValue(id, Number(input.value));
      requireElement<HTMLElement>(overlay, `[data-value-for="${id}"]`).textContent =
        `${input.value}${question && 'valueSuffix' in question ? (question.valueSuffix ?? '') : ''}`;
    });
  });
  overlay
    .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[type="text"], textarea')
    .forEach((input) => {
      input.addEventListener('input', () => setValue(input.dataset.questionId ?? '', input.value));
    });

  await new Promise<void>((resolve) => {
    const form = requireElement<HTMLFormElement>(overlay, 'form');
    form.onsubmit = (event) => {
      event.preventDefault();
      void (async () => {
        let valid = true;
        for (const question of questions) {
          const item = requireElement<HTMLElement>(overlay, `[data-item-id="${question.id}"]`);
          const error = requireElement<HTMLElement>(item, '.questionnaire-item-error');
          const value = values.get(question.id);
          const missing =
            value === undefined ||
            value === null ||
            (typeof value === 'string' && value.trim() === '');
          if (question.required && missing) {
            valid = false;
            item.classList.add('invalid');
            error.textContent = '请完成这一题。';
          } else if (
            question.kind === 'single_choice' &&
            question.correctAnswer !== undefined &&
            value !== question.correctAnswer
          ) {
            valid = false;
            item.classList.add('invalid');
            error.textContent = question.incorrectFeedback ?? '请重新检查任务说明。';
          }
        }
        if (!valid) {
          requireElement<HTMLElement>(overlay, '.questionnaire-form-error').textContent =
            '还有题目需要检查。';
          overlay
            .querySelector('.invalid')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        const button = requireElement<HTMLButtonElement>(overlay, 'button[type="submit"]');
        button.disabled = true;
        requireElement<HTMLElement>(overlay, '.questionnaire-form-error').textContent = '';
        try {
          await submit({
            block_id: block.id,
            instrument_version: instrument.version,
            wording_profile: instrument.wordingProfile,
            position: block.position,
            item_order: questions.map((question) => question.id),
            responses: questions.map((question) => {
              const value = values.get(question.id);
              const skipped =
                value === undefined ||
                value === null ||
                (typeof value === 'string' && value.trim() === '');
              return {
                item_id: question.id,
                value: skipped ? null : (value ?? null),
                skipped,
                response_ms: answeredAt.get(question.id) ?? Math.round(performance.now() - shownAt),
              };
            }),
          });
          overlay.remove();
          resolve();
        } catch (error) {
          button.disabled = false;
          requireElement<HTMLElement>(overlay, '.questionnaire-form-error').textContent =
            error instanceof Error ? error.message : '问卷保存失败，请重试。';
        }
      })();
    };
  });
}

export async function mountQuestionnaireSequence(
  root: HTMLElement,
  instrument: QuestionnaireInstrument,
  position: QuestionnairePosition,
  options: QuestionnaireMountOptions,
): Promise<void> {
  for (const block of blocksAt(instrument, position)) {
    if (!options.isSubmitted(block.id)) await mountBlock(root, instrument, block, options.submit);
  }
}
