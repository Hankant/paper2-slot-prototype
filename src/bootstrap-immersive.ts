import {
  createOneTrialPreview,
  PREVIEW_TRIAL_ID,
} from './adapters/local-demo/one-trial-preview.js';
import { createScriptedChat } from './adapters/local-chat/scripted-chat.js';
import { ImmersiveRun } from './experiment/immersive-run.js';
import { mountImmersive } from './ui/preview-immersive.js';
import { mountEntry } from './ui/atelier/entry-screen.js';
import { ENTRY_MATERIAL } from './domain/entry-materials.js';

mountEntry(async (entry) => {
  const adapter = createOneTrialPreview({
    adviceForSelf: false,
    requireConsentVersion: ENTRY_MATERIAL.consentVersion,
  });
  const run = new ImmersiveRun(adapter, PREVIEW_TRIAL_ID);
  const chat = createScriptedChat((request) => run.authorizeChat(request));
  await run.initialize({ version: entry.consent_version, acceptedAt: entry.accepted_at });
  run.note('entry_completed', entry);
  mountImmersive(run, chat, () => ({
    simulation: true,
    persistence_scope: 'memory',
    ui_version: 'atelier-2',
    contract_version: '0.3.0',
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
