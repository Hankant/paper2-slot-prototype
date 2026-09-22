import { type ChatService, type TrialFeedback } from '@contracts';
import { ImmersiveRun } from '../experiment/immersive-run.js';
import { ChatPanel } from './atelier/chat-panel.js';
import { symbol, spark } from './atelier/symbols.js';
import { requireElement } from './atelier/dom.js';

export interface ImmersiveMountOptions {
  /** Footer left text (collect mode: no memory-only promises). */
  readonly footer?: string;
  /** Extra remote-save status line shown under the decision area. */
  readonly saveStatus?: string;
  readonly downloadName?: string;
  /** When provided, the download button uses this instead of local exportData. */
  readonly exportRemote?: () => Promise<unknown>;
  /** When provided, replaces plain reload for "new run" (e.g. logout first). */
  readonly onRestart?: () => Promise<void>;
  /** Render an already-persisted outcome immediately (completed/resumed render). */
  readonly completedFeedback?: TrialFeedback;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function totalRewardText(run: ImmersiveRun, mainPoints = 0): string {
  const total = run.practicePoints + mainPoints;
  const rate = run.trial.performance_reference.reward_per_point_cny;
  return rate === null ? `${total} 积分` : `${total} 积分 · ¥${(total * rate).toFixed(2)}`;
}

export function mountImmersive(
  run: ImmersiveRun,
  service: ChatService,
  exportData: () => unknown,
  options: ImmersiveMountOptions = {},
): void {
  const root = requireElement(document, '#paper2-immersive-root');
  let selected =
    run.stage === 'prediction' ? run.independent : run.stage === 'final' ? run.final : '';
  let confidence = run.confidence ?? 50;
  let busy = false;
  let chat: ChatPanel | null = null;
  const get = <T extends HTMLElement>(selector: string): T => requireElement<T>(root, selector);
  const ensureChat = (): ChatPanel => {
    chat ??= new ChatPanel(run, service, renderControls);
    return chat;
  };
  root.innerHTML = `<div class="experience">
    <header class="topbar"><a class="wordmark" href="./index.html"><span class="brand-mark">p.</span> PREDICTION LAB</a><span class="demo-tag"><i></i>研究任务</span><span class="score-counter">当前 ${totalRewardText(run)}</span><span class="round-counter">ROUND <b>01</b><span>/ 01</span></span></header>
    <main><div class="intro"><div><p class="eyebrow">观察 · 判断 · 选择</p><h1>这一轮，你看好哪一台？</h1><p class="intro-copy">预测本轮实际中奖的机器。近期开奖记录供你参考。</p></div><div class="round-note"><span>一次预测，三种可能。</span><span>最后的选择，由你决定。</span></div></div>
    <section class="source-performance-strip" aria-label="来源历史表现"><div><span>人类平均命中率</span><b>${percent(run.trial.performance_reference.human_average_hit_rate)}</b></div><div><span>AI 助手命中率</span><b>${percent(run.trial.performance_reference.ai_hit_rate)}</b></div><p>预测正确 +${run.trial.performance_reference.points_per_correct} 积分</p></section>
    <ol class="progress"><li data-stage="prediction"><span>01</span>独立预测</li><li data-stage="source"><span>02</span>参考来源</li><li data-stage="final"><span>03</span>最终判断</li><li data-stage="ready"><span>04</span>启动开奖</li></ol>
    <section class="machine-stage" aria-label="三台老虎机"><div class="machine-grid"></div><div class="console-base"><span>THREE MACHINES. ONE OUTCOME.</span><span class="live-status"><i></i><span id="machine-status">等待你的选择</span></span></div></section>
    <section class="decision-area" aria-label="当前操作"><div class="decision-copy"><p class="eyebrow" id="step-label"></p><h2 id="step-title"></h2><p id="step-help"></p></div><div class="decision-controls"></div></section>
    <p class="experience-error" role="alert"></p><div class="result-card" hidden></div>
    ${options.saveStatus === undefined ? '' : `<p class="remote-save-status" role="status">${options.saveStatus}</p>`}
    </main><footer class="experience-footer"><span>${options.footer ?? '预测任务 · 本页内存保存，刷新清空'}</span><span>研究界面预览</span></footer></div>`;
  for (const machine of run.trial.machines) {
    const rate = run.trial.visible_history.find(
      (h) => h.machine_id === machine.machine_id,
    )?.observed_hit_rate;
    const cabinet = document.createElement('article');
    cabinet.className = 'slot-cabinet';
    cabinet.dataset.machine = machine.machine_id;
    cabinet.innerHTML = `<div class="selection-marker">已选择</div><div class="cabinet-crown"><span class="crown-line"></span><span>NO. ${machine.machine_id}</span><span class="crown-line"></span></div>
      <div class="cabinet-header"><span class="engraving">PREDICTION</span><h2>机器 ${machine.machine_id}</h2><span class="cabinet-led"></span></div>
      <div class="reel-frame"><div class="reel-windows"></div><div class="payline"><span>▸</span><span>◂</span></div></div>
      <div class="cabinet-controls"><button class="machine-select" aria-label="选择机器 ${machine.machine_id}" aria-pressed="false"><span>选择</span><b>${machine.machine_id}</b></button><div class="cabinet-grille"></div></div>
      <div class="cabinet-foot"><i></i><span>PREDICTION SERIES</span><i></i></div>
      <div class="machine-history"><span>近期开奖占比</span><b>${rate === undefined ? '—' : Math.round(rate * 100) + '%'}</b><div class="history-track"><i style="width:${rate === undefined ? 0 : rate * 100}%"></i></div></div>`;
    const symbols = ['cherry', 'lemon', 'bell'];
    for (let i = 0; i < 3; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'reel-window';
      const order = [...symbols.slice(i), ...symbols.slice(0, i)];
      cell.innerHTML = `<div class="symbol-strip">${[...order, ...order, ...order, ...order, ...order].map((s) => `<div class="reel-symbol">${symbol(s)}</div>`).join('')}</div>`;
      requireElement(cabinet, '.reel-windows').append(cell);
    }
    requireElement<HTMLButtonElement>(cabinet, 'button').onclick = () => {
      if (
        busy ||
        !['prediction', 'final'].includes(run.stage) ||
        (run.stage === 'prediction' && run.independent !== '') ||
        (run.stage === 'final' && run.final !== '')
      )
        return;
      selected = machine.machine_id;
      updateSelection();
      updateAction();
    };
    get('.machine-grid').append(cabinet);
  }
  function updateSelection(): void {
    root.querySelectorAll<HTMLElement>('.slot-cabinet').forEach((cabinet) => {
      const active = cabinet.dataset.machine === selected;
      cabinet.classList.toggle('selected', active);
      const button = requireElement<HTMLButtonElement>(cabinet, 'button');
      button.setAttribute('aria-pressed', String(active));
      button.disabled =
        busy ||
        !['prediction', 'final'].includes(run.stage) ||
        (run.stage === 'prediction' && run.independent !== '') ||
        (run.stage === 'final' && run.final !== '');
    });
  }
  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    busy = true;
    get('.experience-error').textContent = '';
    updateSelection();
    updateAction();
    try {
      await action();
    } catch (error) {
      get('.experience-error').textContent =
        error instanceof Error ? error.message : '操作失败，请重试';
    } finally {
      busy = false;
      renderControls();
      updateSelection();
      updateAction();
    }
  }
  function updateAction(): void {
    root.querySelectorAll<HTMLButtonElement>('.decision-controls button').forEach((b) => {
      b.disabled = busy || (b.dataset.requiresSelection === 'true' && !selected);
    });
  }
  function renderControls(): void {
    updateSelection();
    const group =
      run.stage === 'chat'
        ? 'source'
        : ['spinning', 'feedback'].includes(run.stage)
          ? 'ready'
          : run.stage;
    const steps = ['prediction', 'source', 'final', 'ready'];
    root.querySelectorAll<HTMLElement>('.progress li').forEach((li) => {
      li.classList.toggle('current', li.dataset.stage === group);
      li.classList.toggle('done', steps.indexOf(li.dataset.stage ?? '') < steps.indexOf(group));
    });
    const controls = get('.decision-controls');
    controls.replaceChildren();
    const copy: Record<string, string[]> = {
      prediction: ['01 / 你的判断', '先做一个独立预测', '点击机柜选择机器，再确认你的信心。'],
      source: [
        '02 / 参考来源',
        '这一轮，想参考谁？',
        `你的独立预测是机器 ${run.independent}，已锁定。`,
      ],
      chat: ['02 / 与助手对话', '听听助手的建议', '阅读完成后，返回这里做最终判断。'],
      final: [
        '03 / 最终判断',
        '现在，由你做最后的选择',
        run.source === 'ai'
          ? `助手建议机器 ${run.advice?.advice_target_machine_id}。你可以保留或改变原先的预测。`
          : '你选择依据自己的判断。确认最终预测后即可开奖。',
      ],
      ready: [
        '04 / 揭晓时刻',
        `最终预测：机器 ${run.final}`,
        '预测已锁定。按下拉杆，看看这一轮的结果。',
      ],
      spinning: ['04 / 正在开奖', '让转轮揭晓答案', '本轮预测已锁定，请稍候。'],
      feedback: run.completed
        ? [
            '本轮完成',
            '感谢完成本次任务',
            '研究结束说明：本次试运行中的 AI 表现档位与建议输出由研究程序控制，并非由外部大语言模型实时生成。这样设置是为了保证不同参与者看到可比较的材料。',
          ]
        : [
            '等待保存确认',
            '结果已揭晓，记录尚未全部确认',
            '请重试保存。收到服务器完成回执后才能开始新一轮。',
          ],
    };
    const text = copy[run.stage] ?? [];
    get('#step-label').textContent = text[0] ?? '';
    get('#step-title').textContent = text[1] ?? '';
    get('#step-help').textContent = text[2] ?? '';
    if (run.stage === 'prediction') {
      controls.innerHTML = `<div class="confidence-control"><label for="confidence">预测信心 <b id="confidence-value">${confidence}<small> / 100</small></b></label><input id="confidence" aria-label="预测信心" type="range" min="0" max="100" value="${confidence}"></div><button class="primary" data-requires-selection="true">确认独立预测 <span>→</span></button>`;
      get<HTMLInputElement>('#confidence').oninput = (e) => {
        confidence = Number((e.target as HTMLInputElement).value);
        get('#confidence-value').innerHTML = `${confidence}<small> / 100</small>`;
      };
      get<HTMLButtonElement>('.primary').onclick = () =>
        void perform(async () => {
          await run.predict(selected, confidence);
          renderControls();
        });
    } else if (run.stage === 'source') {
      controls.innerHTML = `<div class="source-options"><button data-source="human"><span class="source-icon">◎</span><span><b>依据自己判断</b><small>保留独立思考的空间</small></span><span>→</span></button><button data-source="ai"><span class="source-icon">${spark}</span><span><b>参考 AI 建议</b><small>与研究助手聊一聊</small></span><span>→</span></button></div>`;
      controls.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((b) => {
        b.onclick = () =>
          void perform(async () => {
            await run.chooseSource(b.dataset.source as 'human' | 'ai');
            selected = '';
            if (run.stage === 'chat') ensureChat().open();
            renderControls();
          });
      });
    } else if (run.stage === 'chat') {
      controls.innerHTML = '<button class="primary">继续与助手对话 <span>↗</span></button>';
      get<HTMLButtonElement>('.primary').onclick = () => ensureChat().open();
    } else if (run.stage === 'final') {
      controls.innerHTML =
        '<button class="primary" data-requires-selection="true">锁定最终预测 <span>→</span></button>';
      get<HTMLButtonElement>('.primary').onclick = () =>
        void perform(async () => {
          await run.confirmFinal(selected);
          renderControls();
        });
    } else if (run.stage === 'ready') {
      controls.innerHTML =
        '<button class="draw-lever" aria-label="拉杆开奖"><span class="lever-mechanism"><i></i><b></b></span><span>启动开奖<small>PULL TO REVEAL</small></span><span>↓</span></button>';
      get<HTMLButtonElement>('.draw-lever').onclick = () => void perform(draw);
    } else if (run.stage === 'feedback' && !run.completed) {
      controls.innerHTML = '<button class="primary">重试保存并完成</button>';
      get<HTMLButtonElement>('.primary').onclick = () =>
        void perform(async () => {
          const feedback = await run.resumeFeedback();
          showOutcome(feedback);
          await run.presentFeedback(feedback);
        });
    } else if (run.stage === 'feedback') {
      controls.innerHTML =
        '<button class="secondary download-record">下载本轮记录 ↓</button><button class="primary restart">重新体验 <span>↻</span></button>';
      get<HTMLButtonElement>('.restart').onclick = () => {
        void perform(async () => {
          await options.onRestart?.();
          chat?.dispose();
          window.location.reload();
        });
      };
      get<HTMLButtonElement>('.download-record').onclick = () => {
        void perform(async () => {
          const data = options.exportRemote ? await options.exportRemote() : exportData();
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = options.downloadName ?? 'paper2-atelier-demo.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      };
    }
    get('#machine-status').textContent =
      run.stage === 'spinning'
        ? '转轮运行中'
        : run.stage === 'feedback'
          ? '本轮已揭晓'
          : selected
            ? `已选择机器 ${selected}`
            : '等待你的选择';
    updateAction();
  }
  function showOutcome(feedback: TrialFeedback): void {
    root.querySelectorAll<HTMLElement>('.slot-cabinet').forEach((cabinet) => {
      const won = cabinet.dataset.machine === feedback.actual_winner_machine_id;
      cabinet.classList.toggle('winner', won);
      cabinet.classList.remove('spinning');
      cabinet.querySelectorAll<HTMLElement>('.symbol-strip').forEach((strip, i) => {
        strip.innerHTML = `<div class="reel-symbol">${symbol(won ? 'bell' : (['cherry', 'lemon', 'bell'][i] ?? 'lemon'))}</div>`;
      });
      requireElement(cabinet, '.selection-marker').textContent = won
        ? '本轮中奖'
        : cabinet.dataset.machine === run.final
          ? '你的预测'
          : '未中奖';
      cabinet.classList.add('revealed');
    });
    const result = get('.result-card');
    result.hidden = false;
    result.innerHTML = `<div class="result-symbol">${symbol('bell')}</div><div><p class="eyebrow">本轮结果</p><h2>机器 ${feedback.actual_winner_machine_id} 中奖</h2><p>独立预测 ${run.independent} · 最终预测 ${run.final}${run.source === 'ai' ? ` · 助手建议 ${run.advice?.advice_target_machine_id}` : ''}</p></div><div class="result-score"><b>+${feedback.points_awarded}</b><span>${feedback.final_correct ? '预测正确' : '本轮未命中'} · 累计 ${totalRewardText(run, feedback.points_awarded)}</span></div>`;
    const score = root.querySelector<HTMLElement>('.score-counter');
    if (score) score.textContent = `累计 ${totalRewardText(run, feedback.points_awarded)}`;
  }
  async function draw(): Promise<void> {
    const result = await run.startDraw();
    renderControls();
    root.querySelectorAll('.slot-cabinet').forEach((c) => c.classList.add('spinning'));
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    run.note('animation_mode', reduced ? 'reduced' : 'full');
    await new Promise((resolve) => setTimeout(resolve, reduced ? 200 : 2200));
    showOutcome(result);
    run.note('outcome_visible');
    await run.presentFeedback(result);
    renderControls();
  }
  document.addEventListener('visibilitychange', () =>
    run.note('visibility_changed', document.visibilityState),
  );
  renderControls();
  // Resumed/completed render: the outcome is already persisted server-side.
  if (options.completedFeedback) showOutcome(options.completedFeedback);
}
