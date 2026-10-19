import {
  experimentPlanSchema,
  type ExperimentPlan,
  type FlowModule,
} from '../contracts/experiment-plan.js';
import { QUESTIONNAIRE_INSTRUMENT } from './questionnaire-instrument-demo.js';

/** Engineering defaults, not a finalized research protocol. Edit counts/order here.
 * Server freezes this public plan in each new session; existing sessions keep their plan.
 * Consent/instructions remain the mandatory entry gate; completion is automatic at the end.
 */
export function createExperimentPlan(practiceRounds = 3, formalRounds = 8): ExperimentPlan {
  const questionnaire = (position: 'pre' | 'post'): FlowModule => ({
    kind: 'questionnaire',
    module_id: `${position}-questionnaire`,
    position,
    instrument_version: QUESTIONNAIRE_INSTRUMENT.version,
    block_ids: QUESTIONNAIRE_INSTRUMENT.blocks
      .filter((b) => b.position === position)
      .map((b) => b.id),
  });
  const practice: FlowModule = {
    kind: 'trials',
    block: {
      block_id: 'practice',
      block_kind: 'test',
      block_index: 0,
      total_trials: practiceRounds,
      display_label: '试玩',
      intro_notice: `共 ${practiceRounds} 轮，熟悉独立预测、来源选择与开奖。试玩不显示积分，不计入正式成绩或奖励。`,
      outro_notice: '试玩结束',
      scores_excluded_from_formal: true,
    },
  };
  const formal: FlowModule = {
    kind: 'trials',
    block: {
      block_id: 'formal',
      block_kind: 'formal',
      block_index: 1,
      total_trials: formalRounds,
      display_label: '正式实验',
      intro_notice: `共 ${formalRounds} 轮。每轮最终预测正确即可获得积分，正式积分用于奖励计算。`,
      outro_notice: '正式实验结束',
      scores_excluded_from_formal: false,
    },
  };
  // Move questionnaire('pre') before practice here when needed. Individual
  // questionnaire blocks may also be split into separate modules using block_ids.
  return experimentPlanSchema.parse({
    version: 'flow-2026-09-23-v1',
    modules: [practice, questionnaire('pre'), formal, questionnaire('post')],
  });
}

export const EXPERIMENT_PLAN = createExperimentPlan();
