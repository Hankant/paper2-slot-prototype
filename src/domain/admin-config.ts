import { z } from 'zod';
import { experimentPlanSchema } from '../contracts/experiment-plan.js';
import { QUESTIONNAIRE_INSTRUMENT } from './questionnaire-instrument-demo.js';

export const conditionSchema = z
  .object({
    condition_id: z.string().trim().min(1).max(80),
    human_average_hit_rate: z.number().finite().min(0).max(1),
    ai_hit_rate: z.number().finite().min(0).max(1),
    ai_accuracy_tier: z.string().trim().min(1).max(80),
    points_per_correct: z.number().int().min(0).max(100000),
    reward_per_point_cny: z.number().finite().min(0).max(10000).nullable(),
  })
  .strict();
export const adminConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    plan: experimentPlanSchema,
    conditions: z.array(conditionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (new Set(config.conditions.map((c) => c.condition_id)).size !== config.conditions.length)
      ctx.addIssue({ code: 'custom', message: '条件 ID 必须唯一' });
    for (const m of config.plan.modules) {
      if (m.kind === 'trials') {
        if (m.block.scores_excluded_from_formal !== (m.block.block_kind === 'test'))
          ctx.addIssue({
            code: 'custom',
            message: '试玩必须排除正式奖励；正式区块必须计入正式奖励',
          });
      } else if (
        m.instrument_version !== QUESTIONNAIRE_INSTRUMENT.version ||
        m.block_ids.some(
          (id) =>
            !QUESTIONNAIRE_INSTRUMENT.blocks.some((b) => b.id === id && b.position === m.position),
        )
      )
        ctx.addIssue({ code: 'custom', message: '问卷区块或版本与已发布题库不一致' });
    }
    if (!config.plan.modules.some((m) => m.kind === 'trials' && m.block.block_kind === 'formal'))
      ctx.addIssue({ code: 'custom', message: '至少需要一个正式任务区块' });
  });
export type AdminConfig = z.infer<typeof adminConfigSchema>;
