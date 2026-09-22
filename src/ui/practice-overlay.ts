import type { EventPayloadMap, PerformanceReference } from '@contracts';

interface PracticeTrial {
  readonly id: string;
  readonly recentOutcomeShare: Readonly<Record<'A' | 'B' | 'C', number>>;
  readonly winner: 'A' | 'B' | 'C';
}

const PRACTICE_VERSION = 'slot-practice-0.1.0';
const PRACTICE_TRIALS: ReadonlyArray<PracticeTrial> = [
  { id: 'practice-01', recentOutcomeShare: { A: 0.5, B: 0.3, C: 0.2 }, winner: 'A' },
  { id: 'practice-02', recentOutcomeShare: { A: 0.25, B: 0.5, C: 0.25 }, winner: 'C' },
  { id: 'practice-03', recentOutcomeShare: { A: 0.3, B: 0.25, C: 0.45 }, winner: 'B' },
] as const;

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function rewardText(reference: PerformanceReference, points: number): string {
  if (reference.reward_per_point_cny === null) return `${points} 积分`;
  return `${points} 积分 · 奖励 ¥${(points * reference.reward_per_point_cny).toFixed(2)}`;
}

export async function mountPractice(
  root: HTMLElement,
  reference: PerformanceReference,
  submit: (payload: EventPayloadMap['practice_completed']) => Promise<void>,
): Promise<void> {
  const records: EventPayloadMap['practice_completed']['trials'] = [];
  let index = 0;
  let selected = '';
  let revealed = false;
  let startedAt = performance.now();

  return new Promise<void>((resolve, reject) => {
    function render(): void {
      const trial = PRACTICE_TRIALS[index];
      if (!trial) return;
      const points = records.reduce((sum, item) => sum + item.points_awarded, 0);
      root.innerHTML = `<div class="practice-shell">
        <header class="practice-topbar"><span class="practice-brand">PREDICTION LAB</span><span>试玩 ${index + 1} / ${PRACTICE_TRIALS.length}</span></header>
        <main class="practice-main">
          <section class="practice-copy"><p class="eyebrow">操作练习</p><h1>先试玩三轮，熟悉预测与计分</h1><p>根据各机器的近期开奖占比，预测下一轮实际中奖的机器。试玩结果会保存，但不计入正式任务表现。</p></section>
          <div class="practice-layout">
            <section class="practice-game" aria-label="试玩老虎机">
              <div class="practice-machines">${(['A', 'B', 'C'] as const)
                .map(
                  (
                    machine,
                  ) => `<button class="practice-machine${selected === machine ? ' selected' : ''}${revealed && trial.winner === machine ? ' winner' : ''}" data-machine="${machine}" ${revealed ? 'disabled' : ''}>
                    <span>机器</span><b>${machine}</b><small>近期开奖占比 ${percent(trial.recentOutcomeShare[machine])}</small>
                  </button>`,
                )
                .join('')}</div>
              <div class="practice-action">
                <div>${revealed ? `<strong>本轮中奖：机器 ${trial.winner}</strong><span>${selected === trial.winner ? `预测正确，+${reference.points_per_correct} 积分` : '本轮未命中，+0 积分'}</span>` : '<strong>请选择一台机器</strong><span>选择后确认，系统将揭晓本轮结果。</span>'}</div>
                <button class="primary" id="practice-next" ${selected ? '' : 'disabled'}>${revealed ? (index === PRACTICE_TRIALS.length - 1 ? '完成试玩' : '下一轮') : '确认并开奖'}</button>
              </div>
            </section>
            <aside class="performance-panel" aria-label="本实验展示的来源表现">
              <p class="eyebrow">来源表现</p><h2>本轮参考信息</h2>
              <div><span>人类平均命中率</span><b>${percent(reference.human_average_hit_rate)}</b><small>来自同类任务的人类平均表现</small></div>
              <div><span>AI 助手命中率</span><b>${percent(reference.ai_hit_rate)}</b><small>本次实验分配的 AI 表现水平</small></div>
              <footer><span>当前累计</span><strong>${rewardText(reference, points)}</strong></footer>
            </aside>
          </div>
        </main>
      </div>`;
      root.querySelectorAll<HTMLButtonElement>('[data-machine]').forEach((button) => {
        button.onclick = () => {
          if (revealed) return;
          selected = button.dataset.machine ?? '';
          render();
        };
      });
      const next = root.querySelector<HTMLButtonElement>('#practice-next');
      if (!next) return;
      next.onclick = () => {
        if (!selected) return;
        if (!revealed) {
          const correct = selected === trial.winner;
          records.push({
            practice_trial_id: trial.id,
            predicted_machine_id: selected,
            actual_winner_machine_id: trial.winner,
            correct,
            points_awarded: correct ? reference.points_per_correct : 0,
            response_ms: Math.round(performance.now() - startedAt),
          });
          revealed = true;
          render();
          return;
        }
        if (index < PRACTICE_TRIALS.length - 1) {
          index += 1;
          selected = '';
          revealed = false;
          startedAt = performance.now();
          render();
          return;
        }
        const totalPoints = records.reduce((sum, item) => sum + item.points_awarded, 0);
        next.disabled = true;
        next.textContent = '正在保存…';
        void submit({
          practice_version: PRACTICE_VERSION,
          condition_id: reference.condition_id,
          human_average_hit_rate: reference.human_average_hit_rate,
          ai_hit_rate: reference.ai_hit_rate,
          ai_accuracy_tier: reference.ai_accuracy_tier,
          points_per_correct: reference.points_per_correct,
          reward_per_point_cny: reference.reward_per_point_cny,
          trials: records,
          total_points: totalPoints,
        }).then(resolve, reject);
      };
    }
    render();
  });
}
