import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from '../adapters/local-demo/one-trial-preview.js';
import {
  CONTRACT_VERSION,
  parseEventEnvelope,
  publicTrialSchema,
  saveReceiptSchema,
  trialFeedbackSchema,
  type PublicTrial,
  type Session,
  type TrialFeedback,
} from '@contracts';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing preview element: ${id}`);
  return value as T;
}
const choices = element('choices');
const confirm = element<HTMLButtonElement>('confirm');
const confidence = element<HTMLInputElement>('confidence');
const restart = element<HTMLButtonElement>('restart');
const exportButton = element<HTMLButtonElement>('export');
let adapter = createOneTrialPreview();
let session: Session;
let trial: PublicTrial;
let stage: 'prediction' | 'source' | 'final' | 'feedback' = 'prediction';
let selected = '';
let independent = '';
let source = '';
let sequence = 0;
let busy = false;
let lastFeedback: TrialFeedback | null = null;
let stageStart = performance.now();

async function save(type: string, payload: unknown): Promise<void> {
  const event = parseEventEnvelope({
    schema_version: '0.3.0',
    contract_version: CONTRACT_VERSION,
    client_version: '0.3.0',
    material_version: '0.3.0',
    protocol_version: 'unreleased',
    session_id: session.session_id,
    participant_id: session.participant_id,
    event_id: crypto.randomUUID(),
    sequence_no: sequence,
    phase: 'main',
    event_type: type,
    client_timestamp: new Date().toISOString(),
    elapsed_ms: Math.round(performance.now() - stageStart),
    ...(type === 'session_completion_requested' ? {} : { trial_id: PREVIEW_TRIAL_ID }),
    payload,
  });
  const receipt = saveReceiptSchema.parse(await adapter.resultStore.saveEvents(session, [event]));
  if (!receipt.acknowledged_event_ids.includes(event.event_id)) {
    throw new Error(receipt.rejected_events[0]?.reason_message ?? '未获得保存确认');
  }
  sequence += 1;
  element('save-status').textContent = `本页内存已确认 ${sequence} 条模拟记录 · 未上传`;
}
function selection(): { machine_id: string; display_position: string } {
  const machine = trial.machines.find((m) => m.machine_id === selected);
  if (!machine) throw new Error('请选择机器');
  return { machine_id: machine.machine_id, display_position: machine.display_position };
}
function button(value: string, title: string, detail: string): HTMLButtonElement {
  const control = document.createElement('button');
  control.className = 'choice';
  control.type = 'button';
  control.dataset.value = value;
  control.setAttribute('aria-pressed', 'false');
  const name = document.createElement('strong');
  name.textContent = title;
  const note = document.createElement('span');
  note.textContent = detail;
  control.append(name, note);
  control.addEventListener('click', () => {
    if (busy) return;
    selected = value;
    choices
      .querySelectorAll('button')
      .forEach((item) => item.setAttribute('aria-pressed', String(item === control)));
    confirm.disabled = false;
  });
  return control;
}
function render(): void {
  selected = '';
  stageStart = performance.now();
  choices.replaceChildren();
  confirm.disabled = true;
  document.querySelectorAll<HTMLElement>('[data-step]').forEach((step) => {
    step.classList.toggle('active', step.dataset.step === stage);
  });
  element('confidence-group').hidden = stage !== 'prediction';
  element('advice').hidden = stage !== 'final';
  confirm.hidden = stage === 'feedback';
  restart.hidden = stage !== 'feedback';
  exportButton.hidden = stage !== 'feedback';
  const text = {
    prediction: [
      '独立判断',
      '选择你预测会中奖的机器',
      '下方是模拟历史命中率，不代表下一轮一定中奖。',
      '确认独立预测',
    ],
    source: [
      '来源选择',
      '你希望参考哪个来源？',
      '本预览中的“自己”指你的独立判断。选择来源后展示模拟 AI 建议，最终答案仍由你确认。',
      '确认来源并查看建议',
    ],
    final: [
      '最终判断',
      '现在确认最终预测',
      '独立预测已经锁定。你可以保留答案，也可以修改；来源选择会单独记录。',
      '确认最终预测并开奖',
    ],
    feedback: [
      '本轮结束',
      '这一轮的结果',
      '按实际中奖机器计分，历史概率较高不等于这一轮预测正确。',
      '',
    ],
  }[stage];
  element('stage-label').textContent = text[0] ?? '';
  element('stage-title').textContent = text[1] ?? '';
  element('stage-help').textContent = text[2] ?? '';
  confirm.textContent = text[3] ?? '';
  if (stage === 'source') {
    choices.append(
      button('human', '自己', `独立预测：机器 ${independent}`),
      button('ai', '模拟 AI', '选择后查看预设建议'),
    );
  } else if (stage !== 'feedback') {
    for (const machine of trial.machines) {
      const history = trial.visible_history.find((h) => h.machine_id === machine.machine_id);
      choices.append(
        button(
          machine.machine_id,
          machine.label,
          `模拟历史命中率 ${Math.round((history?.observed_hit_rate ?? 0) * 100)}%`,
        ),
      );
    }
  }
}
async function initialize(): Promise<void> {
  lastFeedback = null;
  adapter = createOneTrialPreview();
  sequence = 0;
  stage = 'prediction';
  source = '';
  independent = '';
  element('result').hidden = true;
  element('error').textContent = '';
  element('feedback-status').textContent = '';
  confidence.value = '50';
  element('confidence-output').textContent = '50';
  element('save-status').textContent = '未上传 · 仅本页内存';
  session = await adapter.sessionService.openSession({
    entry_code: 'PREVIEW-ONLY',
    observed_device_class: 'unknown',
    observed_participation_mode: 'unknown',
    client_versions: {
      contract_version: CONTRACT_VERSION,
      material_version: '0.3.0',
      client_version: '0.3.0',
      protocol_version: 'unreleased',
    },
  });
  trial = publicTrialSchema.parse(
    await adapter.trialService.loadTrial(session, PREVIEW_TRIAL_ID),
  ) as PublicTrial;
  render();
}
async function advance(): Promise<void> {
  if (stage === 'prediction') {
    const answer = selection();
    await save('prediction_submitted', answer);
    await save('confidence_submitted', { confidence_percent: Number(confidence.value) });
    independent = answer.machine_id;
    stage = 'source';
    render();
  } else if (stage === 'source') {
    source = selected;
    await save('source_selected', { source });
    const advice = await adapter.trialService.loadAdvice(session, PREVIEW_TRIAL_ID);
    stage = 'final';
    render();
    element('advice').textContent = advice.copy;
    await save('advice_revealed', { advice_id: advice.advice_id, revealed_at_phase: 'main' });
  } else if (stage === 'final') {
    const answer = selection();
    await save('final_prediction_submitted', {
      ...answer,
      changed_after_advice: answer.machine_id !== independent,
    });
    const feedback = trialFeedbackSchema.parse(
      await adapter.trialService.getFeedback(session, PREVIEW_TRIAL_ID),
    );
    lastFeedback = feedback as TrialFeedback;
    stage = 'feedback';
    render();
    const result = element('result');
    result.hidden = false;
    result.textContent = `中奖：机器 ${feedback.actual_winner_machine_id} ｜ 独立预测：${independent} ｜ 最终预测：${answer.machine_id} ｜ ${feedback.final_correct ? '预测正确' : '预测错误'} +${feedback.points_awarded} 模拟积分`;
    await save('feedback_presented', { presented_at_ms: Math.round(performance.now()) });
    await save('session_completion_requested', { ack_required_event_count: sequence });
    const receipt = saveReceiptSchema.parse(await adapter.sessionService.finishSession(session));
    if (receipt.session_status !== 'completed') throw new Error('尚未确认完成');
    element('feedback-status').textContent =
      '演示完成。模拟建议是 B，固定中奖者是 C；重复体验使用同一材料。';
  }
}
confirm.addEventListener('click', async () => {
  if (busy || !selected) return;
  busy = true;
  confirm.disabled = true;
  element('error').textContent = '';
  try {
    await advance();
  } catch (error) {
    element('error').textContent =
      `${error instanceof Error ? error.message : '操作失败'}。这是内存预览，请刷新重新开始。`;
  } finally {
    busy = false;
  }
});
confidence.addEventListener('input', () => {
  element('confidence-output').textContent = confidence.value;
});
restart.addEventListener('click', () => {
  void initialize().catch((error: Error) => {
    element('error').textContent = error.message;
  });
});
exportButton.addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          {
            simulation: true,
            persistence_scope: 'memory',
            contract_version: CONTRACT_VERSION,
            feedback: lastFeedback,
            events: adapter.exportEvents(),
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'paper2-one-trial-simulation.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void initialize().catch((error: Error) => {
  element('error').textContent = error.message;
});
