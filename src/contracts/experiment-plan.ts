import { z } from 'zod';

export const blockSpecSchema = z
  .object({
    block_id: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    block_kind: z.enum(['test', 'formal']),
    block_index: z.number().int().nonnegative(),
    total_trials: z.number().int().min(1).max(500),
    display_label: z.string().min(1),
    intro_notice: z.string().min(1),
    outro_notice: z.string().min(1),
    scores_excluded_from_formal: z.boolean(),
  })
  .strict();

export const experimentPlanSchema = z
  .object({
    version: z.string().min(1),
    modules: z
      .array(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('trials'), block: blockSpecSchema }).strict(),
          z
            .object({
              kind: z.literal('questionnaire'),
              module_id: z.string().min(1),
              position: z.enum(['pre', 'post']),
              instrument_version: z.string().min(1),
              block_ids: z.array(z.string().min(1)).min(1),
            })
            .strict(),
        ]),
      )
      .min(1),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const blocks = plan.modules.flatMap((m) => (m.kind === 'trials' ? [m.block] : []));
    const ids = plan.modules.map((m) => (m.kind === 'trials' ? m.block.block_id : m.module_id));
    const questions = plan.modules.flatMap((m) => (m.kind === 'questionnaire' ? m.block_ids : []));
    if (
      !blocks.length ||
      new Set(ids).size !== ids.length ||
      new Set(questions).size !== questions.length ||
      blocks.some((b, i) => b.block_index !== i)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '流程需要试次模块、唯一模块/问卷 ID，以及连续的试次模块索引',
      });
  });

export type ExperimentPlan = z.infer<typeof experimentPlanSchema>;
export type FlowModule = ExperimentPlan['modules'][number];

export function trialIds(block: { block_id: string; total_trials: number }): string[] {
  return Array.from({ length: block.total_trials }, (_, i) => `${block.block_id}-trial-${i}`);
}
