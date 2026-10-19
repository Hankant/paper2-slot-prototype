import { rewardCode } from '../domain/reward-code.js';
import { RunOrchestrator } from '../experiment/run-orchestrator.js';
import type { ImmersiveRun } from '../experiment/immersive-run.js';
import { createScriptedChat } from '../adapters/local-chat/scripted-chat.js';
import { QUESTIONNAIRE_INSTRUMENT } from '../domain/questionnaire-instrument-demo.js';
import { mountQuestionnaireSequence } from './questionnaire-overlay.js';
import { mountImmersive, type ImmersiveMountOptions } from './preview-immersive.js';
import { mountBlockSwitchScreen } from './atelier/block-switch-screen.js';
import { requireElement } from './atelier/dom.js';

/** The same flow renderer is used by preview and SQLite collection. */
export async function mountExperimentFlow(
  run: ImmersiveRun,
  exportData: () => unknown,
  options: ImmersiveMountOptions = {},
): Promise<void> {
  const plan = run.session.experiment_plan;
  if (!plan) throw new Error('会话没有多轮流程配置');
  const root = requireElement(document, '#paper2-immersive-root');
  const orchestrator = new RunOrchestrator(run, plan);
  const chat = createScriptedChat((request) => run.authorizeChat(request));
  let dispose: (() => void) | undefined;
  await run.hydrateFeedbacks();

  async function safeRender(): Promise<void> {
    try {
      await render();
    } catch (error) {
      dispose?.();
      dispose = undefined;
      root.innerHTML =
        '<main class="entry-main"><h1>暂时无法继续</h1><p role="alert"></p><button class="primary">重试连接</button></main>';
      requireElement(root, '[role="alert"]').textContent =
        error instanceof Error ? error.message : '请检查网络后重试';
      requireElement<HTMLButtonElement>(root, 'button').onclick = () => void safeRender();
    }
  }
  async function render(): Promise<void> {
    dispose?.();
    dispose = undefined;
    const module = orchestrator.nextModule();
    if (!module) {
      root.innerHTML =
        '<main class="entry-main"><h1>正在确认全部记录</h1><p role="alert"></p><button class="primary" hidden>重试保存</button></main>';
      try {
        await run.finish();
      } catch (error) {
        requireElement(root, '[role="alert"]').textContent =
          error instanceof Error ? error.message : '保存失败';
        const retry = requireElement<HTMLButtonElement>(root, 'button');
        retry.hidden = false;
        retry.onclick = () => void safeRender();
        return;
      }
      const ref = run.trial.performance_reference;
      const points = run.points(false);
      root.innerHTML = `<main class="entry-main flow-completed"><p class="eyebrow">实验完成</p><h1>感谢完成本次任务</h1><p>全部作答已确认保存。</p><h2>正式积分：${points}</h2><p>兑奖编号：<strong class="reward-code">${rewardCode(run.session.session_id)}</strong></p><p>${ref.reward_per_point_cny === null ? '现金兑换率尚未配置，请联系实验者确认奖励。' : `按本会话规则计算的奖励：¥${(points * ref.reward_per_point_cny).toFixed(2)}（待实验者发放）`}</p><p>研究结束说明：本次试运行中的 AI 表现档位与建议输出由研究程序控制，并非由外部大语言模型实时生成。</p><button class="secondary download-record">下载全部记录 ↓</button><button class="primary restart">重新体验</button><p role="alert"></p></main>`;
      const report = (e: unknown) => {
        requireElement(root, '[role="alert"]').textContent =
          e instanceof Error ? e.message : '操作失败';
      };
      requireElement<HTMLButtonElement>(root, '.download-record').onclick = () =>
        void (async () => {
          const data = options.exportRemote ? await options.exportRemote() : exportData();
          const url = URL.createObjectURL(
            new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = options.downloadName ?? 'paper2-multi-round.json';
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        })().catch(report);
      requireElement<HTMLButtonElement>(root, '.restart').onclick = () =>
        void (async () => {
          await options.onRestart?.();
          location.reload();
        })().catch(report);
      return;
    }
    if (module.kind === 'questionnaire') {
      if (module.instrument_version !== QUESTIONNAIRE_INSTRUMENT.version)
        throw new Error('本会话问卷版本与当前材料不一致，请联系实验者');
      const blocks = module.block_ids.map((id) => {
        const block = QUESTIONNAIRE_INSTRUMENT.blocks.find((b) => b.id === id);
        if (!block) throw new Error(`问卷区块不存在：${id}`);
        return block;
      });
      root.replaceChildren();
      await mountQuestionnaireSequence(
        root,
        { ...QUESTIONNAIRE_INSTRUMENT, blocks },
        module.position,
        {
          draftSessionId: run.session.session_id,
          isSubmitted: (id) => run.hasQuestionnaireBlock(id),
          submit: (payload) => run.submitQuestionnaireBlock(payload),
        },
      );
      return safeRender();
    }
    const block = module.block;
    if (!orchestrator.introduced(block)) {
      mountBlockSwitchScreen({
        root,
        mode: 'intro',
        block,
        badge: block.display_label,
        excludedNotice: block.scores_excluded_from_formal ? '本环节积分不计入正式奖励' : '',
        onContinue: async () => {
          await orchestrator.enter(block);
          await safeRender();
        },
      });
      return;
    }
    const target = orchestrator.currentTrialId(block);
    if (run.trialId !== target) await run.swapTrial(target);
    if (run.stage === 'feedback') await run.resumeFeedback();
    dispose = mountImmersive(run, chat, exportData, {
      ...options,
      ...(run.feedback ? { completedFeedback: run.feedback } : {}),
      onTrialCompleted: async () => {
        await orchestrator.advance(block);
        await render();
      },
    });
    window.scrollTo(0, 0);
  }
  await render();
}
