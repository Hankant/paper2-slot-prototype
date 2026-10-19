import type {
  QuestionnaireBlock,
  QuestionnaireBlockPayload,
  QuestionnaireInstrument,
  QuestionnairePosition,
  QuestionnaireQuestion,
  QuestionnaireResponseValue,
} from '../domain/questionnaire.js';
import { blocksAt } from '../domain/questionnaire.js';
import {
  answerError,
  validateQuestionnaireSubmission,
} from '../domain/questionnaire-validation.js';
import { requireElement } from './atelier/dom.js';
import './questionnaire.css';

export interface QuestionnaireMountOptions {
  readonly draftSessionId?: string;
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
  draftKey?: string,
): Promise<void> {
  type Draft = {
    order: string[];
    values: Record<string, QuestionnaireResponseValue>;
    times: Record<string, number>;
    errors: Record<string, number>;
    elapsed: number;
    pending: QuestionnaireBlockPayload | null;
  };
  let draft: Draft | null = null;
  let storage: Storage | null = null;
  if (draftKey)
    try {
      storage = sessionStorage;
      const raw = storage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        const ids = block.questions.map((q) => q.id);
        if (
          Array.isArray(d.order) &&
          d.order.length === ids.length &&
          new Set(d.order).size === ids.length &&
          d.order.every((id) => ids.includes(id)) &&
          d.values &&
          d.times &&
          d.errors &&
          Number.isFinite(d.elapsed) &&
          d.elapsed >= 0
        ) {
          if (d.pending) validateQuestionnaireSubmission(instrument, d.pending);
          draft = d;
        }
      }
    } catch {
      draft = null;
    }
  const questions = draft
    ? draft.order.map((id) => block.questions.find((q) => q.id === id) as QuestionnaireQuestion)
    : block.randomizeQuestions
      ? shuffled(block.questions)
      : [...block.questions];
  const shownAt = performance.now();
  const elapsed = () => (draft?.elapsed ?? 0) + Math.round(performance.now() - shownAt);
  const answeredAt = new Map<string, number>(Object.entries(draft?.times ?? {}));
  const values = new Map<string, QuestionnaireResponseValue>(Object.entries(draft?.values ?? {}));
  const errors = new Map<string, number>(Object.entries(draft?.errors ?? {}));
  let pending = draft?.pending ?? null;
  const persist = () => {
    if (!storage || !draftKey) return;
    try {
      storage.setItem(
        draftKey,
        JSON.stringify({
          order: questions.map((q) => q.id),
          values: Object.fromEntries(values),
          times: Object.fromEntries(answeredAt),
          errors: Object.fromEntries(errors),
          elapsed: elapsed(),
          pending,
        }),
      );
    } catch {
      storage = null;
    }
  };
  const overlay = document.createElement('section');
  overlay.className = 'questionnaire-overlay';
  overlay.dataset.blockId = block.id;
  overlay.setAttribute('aria-label', instrument.title);
  overlay.innerHTML = `<div class="questionnaire-shell"><header><a class="wordmark" href="./index.html"><span class="brand-mark">p.</span> PREDICTION LAB</a><span>研究问卷</span></header><main><p class="eyebrow">${block.eyebrow}</p><h1>${block.title}</h1>${block.intro ? `<p class="questionnaire-intro">${block.intro}</p>` : ''}<form novalidate><div class="questionnaire-items">${questions.map(renderQuestion).join('')}</div><p class="questionnaire-form-error" role="alert"></p><button type="submit" class="primary">${block.submitLabel}<span>→</span></button></form></main><footer>题项版本 ${instrument.version} · ${instrument.wordingProfile}</footer></div>`;
  root.append(overlay);
  const draftStatus = document.createElement('p');
  draftStatus.className = 'questionnaire-draft-status';
  const showDraftStatus = () => {
    draftStatus.textContent = storage
      ? draft
        ? '已恢复本标签页草稿；提交后才保存至服务器。'
        : '本标签页自动保留草稿；提交后才保存至服务器。'
      : '未启用草稿保存，请完成本页后提交。';
  };
  requireElement(overlay, 'form').prepend(draftStatus);
  persist();
  showDraftStatus();
  const onHide = () => persist();
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onHide);
  for (const q of questions) {
    const value = values.get(q.id);
    if (value === undefined || value === null) continue;
    overlay
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[data-question-id="${q.id}"]`)
      .forEach((input) => {
        if (input instanceof HTMLInputElement && input.type === 'radio')
          input.checked = String(value) === input.value;
        else input.value = String(value);
      });
    if (q.kind === 'slider')
      requireElement(overlay, `[data-value-for="${q.id}"]`).textContent =
        String(value) + (q.valueSuffix ?? '');
  }
  const lockAnswers = () => {
    overlay
      .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
      .forEach((input) => {
        input.disabled = pending !== null;
      });
  };
  lockAnswers();

  const setValue = (id: string, value: QuestionnaireResponseValue): void => {
    values.set(id, value);
    answeredAt.set(id, Math.max(0, elapsed()));
    persist();
    showDraftStatus();
    requireElement<HTMLElement>(overlay, `[data-item-id="${id}"]`).classList.remove('invalid');
    requireElement<HTMLElement>(
      overlay,
      `[data-item-id="${id}"] .questionnaire-item-error`,
    ).textContent = '';
  };
  overlay.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((input) => {
    input.addEventListener('change', () => {
      const id = input.dataset.questionId ?? '';
      const question = questions.find((q) => q.id === id);
      setValue(id, question?.kind === 'likert' ? Number(input.value) : input.value);
    });
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
          const message = answerError(question, value);
          if (message) {
            valid = false;
            item.classList.add('invalid');
            error.textContent = message;
            if (
              question.kind === 'single_choice' &&
              question.correctAnswer !== undefined &&
              typeof value === 'string' &&
              value !== question.correctAnswer
            )
              errors.set(question.id, (errors.get(question.id) ?? 0) + 1);
          }
        }
        persist();
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
          pending ??= {
            block_id: block.id,
            instrument_version: instrument.version,
            wording_profile: instrument.wordingProfile,
            position: block.position,
            comprehension_errors: [...errors].map(([item_id, incorrect_count]) => ({
              item_id,
              incorrect_count,
            })),
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
                response_ms: answeredAt.get(question.id) ?? elapsed(),
              };
            }),
          };
          persist();
          lockAnswers();
          await submit(pending);
          if (storage && draftKey)
            try {
              storage.removeItem(draftKey);
            } catch {
              /* Optional local drafts. */
            }
          window.removeEventListener('pagehide', onHide);
          document.removeEventListener('visibilitychange', onHide);
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
    const key = options.draftSessionId
      ? `paper2.questionnaire.v1:${options.draftSessionId}:${instrument.version}:${block.id}`
      : undefined;
    if (!options.isSubmitted(block.id))
      await mountBlock(root, instrument, block, options.submit, key);
    else if (key)
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Optional local drafts. */
      }
  }
}
