import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from './adapters/local-demo/one-trial-preview.js';
import { createScriptedChat } from './adapters/local-chat/scripted-chat.js';
import { ImmersiveRun } from './experiment/immersive-run.js';
import { mountImmersive } from './ui/preview-immersive.js';
import { mountEntry } from './ui/atelier/entry-screen.js';
import { ENTRY_MATERIAL } from './domain/entry-materials.js';
import { QUESTIONNAIRE_INSTRUMENT } from './domain/questionnaire-instrument-demo.js';
import { mountQuestionnaireSequence } from './ui/questionnaire-overlay.js';
import { requireElement } from './ui/atelier/dom.js';
import { CONTRACT_VERSION } from '@contracts';

mountEntry(async (entry) => {
  const adapter = createOneTrialPreview({
    adviceForSelf: false,
    requireConsentVersion: ENTRY_MATERIAL.consentVersion,
  });
  const root = requireElement(document, '#paper2-immersive-root');
  function questionnaire(position: 'pre' | 'post'): Promise<void> {
    return mountQuestionnaireSequence(root, QUESTIONNAIRE_INSTRUMENT, position, {
      isSubmitted: (blockId) => run.hasQuestionnaireBlock(blockId),
      submit: (payload) => run.submitQuestionnaireBlock(payload),
    });
  }
  const run: ImmersiveRun = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID, {
    beforeCompletion: () => questionnaire('post'),
  });
  const chat = createScriptedChat((request) => run.authorizeChat(request));
  await run.initialize({ version: entry.consent_version, acceptedAt: entry.accepted_at });
  run.note('entry_completed', entry);
  if (!run.restored || run.stage === 'prediction') await questionnaire('pre');
  mountImmersive(run, chat, () => ({
    simulation: true,
    persistence_scope: 'memory',
    ui_version: 'atelier-2',
    contract_version: CONTRACT_VERSION,
    questionnaire_instrument: {
      version: QUESTIONNAIRE_INSTRUMENT.version,
      wording_profile: QUESTIONNAIRE_INSTRUMENT.wordingProfile,
    },
    self_advice: false,
    entry,
    entry_material: ENTRY_MATERIAL,
    session: run.session,
    feedback: run.feedback,
    events: adapter.exportEvents(),
    presentation_audit: run.audit,
  }));
  window.scrollTo(0, 0);
});
