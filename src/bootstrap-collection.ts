import {
  CLIENT_VERSION,
  CONTRACT_VERSION,
  ContractError,
  type EntryCredential,
  type DeviceClass,
} from '@contracts';
import { createRemoteAdapter, type RemoteAdapter } from './adapters/http/remote-adapter.js';
import { createScriptedChat } from './adapters/local-chat/scripted-chat.js';
import { ImmersiveRun } from './experiment/immersive-run.js';
import { mountImmersive } from './ui/preview-immersive.js';
import { mountEntry } from './ui/atelier/entry-screen.js';
import { requireElement } from './ui/atelier/dom.js';
import {
  COLLECTION_MATERIAL,
  type CollectionEntryAcknowledgement,
} from './domain/collection-materials.js';
import { QUESTIONNAIRE_INSTRUMENT } from './domain/questionnaire-instrument-demo.js';
import { mountQuestionnaireSequence } from './ui/questionnaire-overlay.js';

function detectDeviceClass(): DeviceClass {
  if (/ipad|tablet|kindle|playbook/i.test(navigator.userAgent)) return 'tablet';
  return /mobi|iphone|android|phone/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
}

async function startCollection(
  adapter: RemoteAdapter,
  entry?: CollectionEntryAcknowledgement,
): Promise<void> {
  let snapshot = null;
  try {
    snapshot = await adapter.snapshot();
  } catch (error) {
    if (!(error instanceof ContractError) || error.code !== 'SESSION_EXPIRED') throw error;
  }
  if (snapshot) {
    // Resolve lost acknowledgements BEFORE constructing controller state.
    await adapter.flushPending();
    snapshot = await adapter.snapshot();
  }
  if (!snapshot && !entry) {
    showEntry();
    return;
  }
  const observed = entry ?? snapshot?.session.metadata;
  if (!observed) throw new Error('缺少参与方式记录');
  const credential: EntryCredential = {
    entry_code: entry?.entry_code ?? '',
    observed_participation_mode: observed.participation_mode,
    observed_device_class: observed.device_class,
    client_versions: {
      contract_version: CONTRACT_VERSION,
      client_version: CLIENT_VERSION,
      material_version: '0.3.0',
      protocol_version: 'unreleased',
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const root = requireElement(document, '#paper2-immersive-root');
  function questionnaire(position: 'pre' | 'post'): Promise<void> {
    return mountQuestionnaireSequence(root, QUESTIONNAIRE_INSTRUMENT, position, {
      isSubmitted: (blockId) => run.hasQuestionnaireBlock(blockId),
      submit: (payload) => run.submitQuestionnaireBlock(payload),
    });
  }
  const run: ImmersiveRun = new ImmersiveRun(adapter, 'preview-trial-1', {
    credential,
    ...(snapshot ? { snapshot } : {}),
    onAudit: (record) => {
      adapter.queueAudit(record);
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void adapter.saveAudit([]).catch(() => {
            /* queued records retry before finish/reload */
          });
        }, 500);
    },
    flushAudit: () => adapter.flushPending(),
    beforeCompletion: () => questionnaire('post'),
  });
  const accepted = entry ?? (snapshot?.entry as CollectionEntryAcknowledgement);
  await run.initialize({ version: accepted.consent_version, acceptedAt: accepted.accepted_at });
  if (run.restored) {
    const exported = await adapter.export();
    run.restoreAudit(exported.presentation_audit);
    if (run.stage === 'chat') run.note('chat_represented_after_reload');
  } else
    run.note('entry_completed', {
      consent_version: accepted.consent_version,
      instructions_version: accepted.instructions_version,
    });
  if (!run.restored || run.stage === 'prediction') await questionnaire('pre');
  if (run.stage === 'feedback') await run.resumeFeedback();
  mountImmersive(
    run,
    createScriptedChat((request) => run.authorizeChat(request)),
    () => ({}),
    {
      footer: '数据收集试点 · 模拟建议 · 服务器保存 · 同一浏览器会话内刷新可继续',
      saveStatus: '每次作答以服务器回执为准；完成前会确认全部作答与呈现记录。',
      downloadName: 'paper2-collection-export.json',
      exportRemote: async () => {
        await adapter.flushPending();
        return adapter.export();
      },
      onRestart: async () => {
        await adapter.flushPending();
        await adapter.logout();
        if (timer) clearTimeout(timer);
      },
      ...(run.feedback ? { completedFeedback: run.feedback } : {}),
    },
  );
  window.scrollTo(0, 0);
}

function showEntry(): void {
  mountEntry(
    async (base) => {
      const entry = base as CollectionEntryAcknowledgement;
      await startCollection(createRemoteAdapter({ entry }), entry);
    },
    {
      material: COLLECTION_MATERIAL,
      badge: '数据收集试点',
      footerLeft: '预测任务 · 服务器保存试点',
      footerRight: '合成数据 / 非正式招募',
      credential: {},
      detectedDeviceClass: detectDeviceClass(),
    },
  );
}

function boot(): void {
  void startCollection(createRemoteAdapter()).catch((error: unknown) => {
    const root = document.getElementById('paper2-immersive-root');
    if (!root) return;
    root.innerHTML =
      '<main class="entry-main"><h1>暂时无法恢复连接</h1><p role="alert"></p><button class="primary">重试连接</button></main>';
    requireElement(root, 'p').textContent =
      error instanceof Error ? error.message : '请检查网络后重试。';
    requireElement(root, 'button').onclick = boot;
  });
}
boot();
