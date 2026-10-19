import { createOneTrialPreview } from './adapters/local-demo/one-trial-preview.js';
import { ImmersiveRun } from './experiment/immersive-run.js';
import { mountEntry } from './ui/atelier/entry-screen.js';
import { mountExperimentFlow } from './ui/experiment-flow.js';
import { ENTRY_MATERIAL } from './domain/entry-materials.js';
import { EXPERIMENT_PLAN } from './domain/experiment-plan.js';
import { CONTRACT_VERSION } from '@contracts';

mountEntry(async (entry) => {
  const adapter = createOneTrialPreview({
    adviceForSelf: false,
    requireConsentVersion: ENTRY_MATERIAL.consentVersion,
    plan: EXPERIMENT_PLAN,
    seedSession:{questionnaire_validation_version:'1.0.0'},
  });
  const first = EXPERIMENT_PLAN.modules.find((m) => m.kind === 'trials');
  if (first?.kind !== 'trials') throw new Error('缺少任务模块');
  const run = new ImmersiveRun(adapter, `${first.block.block_id}-trial-0`, {
    isLastInSession: () => false,
  });
  await run.initialize({ version: entry.consent_version, acceptedAt: entry.accepted_at });
  run.note('entry_completed', entry);
  await mountExperimentFlow(run, () => ({
    simulation: true,
    persistence_scope: 'memory',
    contract_version: CONTRACT_VERSION,
    session: run.session,
    entry,
    events: adapter.exportEvents(),
    feedbacks: [...run.feedbacks.values()],
    presentation_audit: run.audit,
    points: { practice: run.points(true), formal: run.points(false) },
  }));
});
