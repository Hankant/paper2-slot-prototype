// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOneTrialPreview } from '../../src/adapters/local-demo/one-trial-preview.js';
import { createExperimentPlan } from '../../src/domain/experiment-plan.js';
import { ImmersiveRun } from '../../src/experiment/immersive-run.js';
import { RunOrchestrator } from '../../src/experiment/run-orchestrator.js';
import type { ExperimentPlan } from '@contracts';

export async function completeTrial(run: ImmersiveRun, ai = false) {
  await run.predict('A', 70);
  await run.chooseSource(ai ? 'ai' : 'human');
  if (ai) {
    await run.markAdvicePresented();
    run.chatCompleted = true;
    run.finishChat();
  }
  await run.confirmFinal('C');
  await run.presentFeedback(await run.startDraw());
}
export function compactPlan(): ExperimentPlan {
  return {
    ...createExperimentPlan(2, 3),
    modules: createExperimentPlan(2, 3).modules.filter((m) => m.kind === 'trials'),
  };
}
describe('multi-round orchestrator', () => {
  it('records every round and block before session completion, never counts practice as formal reward', async () => {
    const plan = compactPlan();
    const adapter = createOneTrialPreview({ plan, adviceForSelf: false });
    const run = new ImmersiveRun(adapter, 'practice-trial-0');
    const flow = new RunOrchestrator(run, plan);
    await run.initialize();
    for (const m of plan.modules) {
      if (m.kind !== 'trials') continue;
      await flow.enter(m.block);
      for (let i = 0; i < m.block.total_trials; i++) {
        await completeTrial(run, i % 2 === 0);
        await flow.advance(m.block);
      }
    }
    expect(flow.nextModule()).toBeUndefined();
    expect(run.completed).toBe(false);
    await run.finish();
    expect(run.completed).toBe(true);
    const events = adapter.exportEvents();
    expect(events.filter((e) => e.event_type === 'feedback_presented')).toHaveLength(5);
    expect(events.filter((e) => e.event_type === 'block_completed')).toHaveLength(2);
    expect(events.map((e) => e.sequence_no)).toEqual(events.map((_, i) => i));
    expect(run.points(false)).toBe(
      [...run.feedbacks.values()]
        .filter((f) => f.trial_id.startsWith('formal'))
        .reduce((s, f) => s + f.points_awarded, 0),
    );
    expect(events.at(-1)?.event_type).toBe('session_completion_requested');
  });
  it('restores round 2 without overwriting round 1 or replaying its answers', async () => {
    const plan = compactPlan();
    const adapter = createOneTrialPreview({ plan, adviceForSelf: false });
    const run = new ImmersiveRun(adapter, 'practice-trial-0');
    const flow = new RunOrchestrator(run, plan);
    await run.initialize();
    const m = plan.modules[0]!;
    if (m.kind !== 'trials') throw Error();
    await flow.enter(m.block);
    await completeTrial(run);
    await flow.advance(m.block);
    await run.predict('B', 45);
    const restored = new ImmersiveRun(adapter, 'practice-trial-1', {
      snapshot: { session: run.session, events: adapter.exportEvents() },
    });
    new RunOrchestrator(restored, plan);
    await restored.initialize();
    await restored.hydrateFeedbacks();
    expect(restored.stage).toBe('source');
    expect(restored.independent).toBe('B');
    expect(
      restored.savedEvents().filter((e) => e.event_type === 'prediction_submitted'),
    ).toHaveLength(2);
    expect(restored.feedbacks.size).toBe(1);
    await restored.swapTrial('practice-trial-0');
    expect(restored.stage).toBe('feedback');
    expect(restored.independent).toBe('A');
  });
  it('allows questionnaires before or after practice; rejects premature completion and wrong module', async () => {
    for (const before of [true, false]) {
      const base = createExperimentPlan(1, 1);
      const q = base.modules[1]!;
      const practice = base.modules[0]!;
      const plan = { ...base, modules: before ? [q, practice] : [practice, q] };
      const adapter = createOneTrialPreview({ plan, adviceForSelf: false });
      const run = new ImmersiveRun(adapter, 'practice-trial-0');
      const flow = new RunOrchestrator(run, plan);
      await run.initialize();
      if (!before && practice.kind === 'trials') {
        await flow.enter(practice.block);
        await completeTrial(run);
        await flow.advance(practice.block);
      }
      expect(flow.nextModule()?.kind).toBe('questionnaire');
      if (q.kind !== 'questionnaire') throw Error();
      for (const id of q.block_ids)
        await run.submitQuestionnaireBlock({
          block_id: id,
          position: q.position,
          instrument_version: q.instrument_version,
          wording_profile: 'SELF_AI',
          item_order: ['q'],
          responses: [{ item_id: 'q', value: 50, skipped: false, response_ms: 20 }],
        });
      expect(run.hasQuestionnaireBlock(q.block_ids[0]!)).toBe(true);
      if (before && practice.kind === 'trials') {
        await flow.enter(practice.block);
        expect(run.hasQuestionnaireBlock(q.block_ids[0]!)).toBe(true);
      }
    }
    const plan = compactPlan(),
      adapter = createOneTrialPreview({ plan, adviceForSelf: false });
    const run = new ImmersiveRun(adapter, 'practice-trial-0');
    new RunOrchestrator(run, plan);
    await run.initialize();
    await expect(run.finish()).rejects.toThrow('流程尚未完成');
  });
});
