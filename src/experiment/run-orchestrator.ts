import { trialIds, type ExperimentPlan, type FlowModule, type BlockSpec } from '@contracts';
import { ImmersiveRun } from './immersive-run.js';

export interface BlockSummary {
  trials_completed: number;
  correct_count: number;
  total_points_earned: number;
  had_source_choice: boolean;
}

/** Progress is derived from acknowledged events, never an in-memory cursor. */
export class RunOrchestrator {
  constructor(
    readonly run: ImmersiveRun,
    readonly plan: ExperimentPlan,
  ) {
    run.hooks = { ...run.hooks, isLastInSession: () => false };
  }
  nextModule(): FlowModule | undefined {
    const events = this.run.savedEvents();
    return this.plan.modules.find((m) =>
      m.kind === 'questionnaire'
        ? !m.block_ids.every((id) => this.run.hasQuestionnaireBlock(id))
        : !events.some(
            (e) => e.event_type === 'block_completed' && e.payload.block_id === m.block.block_id,
          ),
    );
  }
  introduced(block: BlockSpec): boolean {
    return this.run
      .savedEvents()
      .some(
        (e) => e.event_type === 'block_intro_presented' && e.payload.block_id === block.block_id,
      );
  }
  currentTrialId(block: BlockSpec): string {
    const events = this.run.savedEvents();
    const ids = trialIds(block);
    return (
      ids.find(
        (id) => !events.some((e) => e.trial_id === id && e.event_type === 'feedback_presented'),
      ) ??
      ids.at(-1) ??
      (() => {
        throw new Error('环节没有试次');
      })()
    );
  }
  async enter(block: BlockSpec): Promise<void> {
    await this.run.submitBlockEvent('block_intro_presented', {
      block_id: block.block_id,
      block_kind: block.block_kind,
      block_index: block.block_index,
      total_trials: block.total_trials,
      intro_notice: block.intro_notice,
    });
    await this.run.swapTrial(this.currentTrialId(block));
  }
  summaryFor(block: BlockSpec): BlockSummary {
    const ids = trialIds(block);
    const feedbacks = ids.flatMap((id) => {
      const f = this.run.feedbacks.get(id);
      return f ? [f] : [];
    });
    return {
      trials_completed: feedbacks.length,
      correct_count: feedbacks.filter((f) => f.final_correct).length,
      total_points_earned: feedbacks.reduce((n, f) => n + f.points_awarded, 0),
      had_source_choice: this.run
        .savedEvents()
        .some((e) => e.event_type === 'source_selected' && ids.includes(e.trial_id ?? '')),
    };
  }
  async advance(block: BlockSpec): Promise<void> {
    const events = this.run.savedEvents();
    const allDone = trialIds(block).every((id) =>
      events.some((e) => e.trial_id === id && e.event_type === 'feedback_presented'),
    );
    if (allDone) {
      await this.run.submitBlockEvent('block_completed', {
        block_id: block.block_id,
        block_kind: block.block_kind,
        block_index: block.block_index,
        ...this.summaryFor(block),
        score_excluded_from_formal: block.scores_excluded_from_formal,
      });
    } else await this.run.swapTrial(this.currentTrialId(block));
  }
}
