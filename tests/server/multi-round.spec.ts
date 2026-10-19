// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollectionServer } from '../../server/app.js';
import { createRemoteAdapter } from '../../src/adapters/http/remote-adapter.js';
import { createExperimentPlan } from '../../src/domain/experiment-plan.js';
import { ImmersiveRun } from '../../src/experiment/immersive-run.js';
import { RunOrchestrator } from '../../src/experiment/run-orchestrator.js';
import { COLLECTION_MATERIAL } from '../../src/domain/collection-materials.js';
import { CONTRACT_VERSION, CLIENT_VERSION, type EntryCredential } from '@contracts';

it('collects 2 practice + 3 formal rounds with restart, frozen plan, per-trial export and no premature completion', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'paper2-multi-'));
  const configured = createExperimentPlan(2, 3);
  const plan = { ...configured, modules: configured.modules.filter((m) => m.kind === 'trials') };
  const options = {
    databasePath: path.join(dir, 'test.sqlite'),
    entryCode: 'TEST-MULTI',
    adminToken: 'test-admin-multi-token',
    experimentPlan: plan,
  };
  let server = createCollectionServer(options);
  let base = '';
  let cookie = '';
  async function listen() {
    await new Promise<void>((resolve) => server.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + (server.server.address() as { port: number }).port;
  }
  await listen();
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await fetch(base + String(input), {
      ...init,
      headers: { ...init?.headers, connection: 'close', ...(cookie ? { cookie } : {}) },
    });
    if (response.headers.get('set-cookie'))
      cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    return response;
  };
  const credential: EntryCredential = {
    entry_code: 'TEST-MULTI',
    observed_participation_mode: 'remote',
    observed_device_class: 'mobile',
    client_versions: {
      contract_version: CONTRACT_VERSION,
      client_version: CLIENT_VERSION,
      material_version: '0.3.0',
      protocol_version: 'unreleased',
    },
  };
  const entry = {
    consent_version: COLLECTION_MATERIAL.consentVersion,
    instructions_version: COLLECTION_MATERIAL.instructionsVersion,
    accepted_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
  };
  let adapter = createRemoteAdapter({ fetchImpl, storage: null, entry });
  let run = new ImmersiveRun(adapter, 'practice-trial-0', { credential });
  let flow = new RunOrchestrator(run, plan);
  try {
    await run.initialize({ version: entry.consent_version, acceptedAt: entry.accepted_at });
    expect(run.session.experiment_plan).toEqual(plan);
    expect(JSON.stringify(await adapter.snapshot())).not.toContain('private_seed');
    await expect(adapter.trialService.getFeedback(run.session, 'formal-trial-2')).rejects.toThrow();
    for (const m of plan.modules) {
      if (m.kind !== 'trials') continue;
      await flow.enter(m.block);
      for (let i = 0; i < m.block.total_trials; i++) {
        await run.predict(i % 2 ? 'B' : 'A', 50 + i);
        await run.chooseSource(i % 2 ? 'ai' : 'human');
        if (i % 2) {
          await run.markAdvicePresented();
          run.chatCompleted = true;
          run.finishChat();
        }
        if (m.block.block_kind === 'formal' && i === 1) {
          const priorEvents = (await adapter.snapshot()).events;
          await server.close();
          server = createCollectionServer({
            ...options,
            experimentPlan: createExperimentPlan(1, 1),
          });
          await listen();
          adapter = createRemoteAdapter({ fetchImpl, storage: null });
          const snapshot = await adapter.snapshot();
          expect(snapshot.events).toEqual(priorEvents);
          expect(snapshot.session.experiment_plan).toEqual(plan);
          run = new ImmersiveRun(adapter, 'formal-trial-1', { credential, snapshot });
          flow = new RunOrchestrator(run, plan);
          await run.initialize();
          await run.hydrateFeedbacks();
          expect(run.independent).toBe('B');
          expect(run.stage).toBe('final');
        }
        await run.confirmFinal('C');
        const result = await run.startDraw();
        await run.presentFeedback(result);
        await flow.advance(m.block);
      }
    }
    await run.finish();
    expect(run.completed).toBe(true);
    const exported = await adapter.export();
    expect(exported.feedbacks).toHaveLength(5);
    expect(exported.trial_results).toHaveLength(5);
    expect(exported.events.filter((e) => e.event_type === 'prediction_submitted')).toHaveLength(5);
    expect(exported.events.map((e) => e.sequence_no)).toEqual(exported.events.map((_, i) => i));
    const csv = await (
      await fetch(base + '/api/admin/export?format=csv', {
        headers: { authorization: 'Bearer test-admin-multi-token' },
      })
    ).text();
    expect(csv.split('\r\n')).toHaveLength(6);
    expect(csv).toContain('trial_id');
    expect(csv).toContain('formal-trial-2');
    await server.close();
    server = createCollectionServer(options);
    await listen();
    expect((await adapter.snapshot()).completed).toBe(true);
    expect((await adapter.export()).feedbacks).toEqual(exported.feedbacks);
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 20000);
