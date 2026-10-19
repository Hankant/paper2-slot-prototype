// @vitest-environment node
// Opt-in: npm run build:all; $env:RUN_LOAD='1'; npx vitest run tests/server/load-50.spec.ts
import { expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createRemoteAdapter } from '../../src/adapters/http/remote-adapter.js';
import { createExperimentPlan } from '../../src/domain/experiment-plan.js';
import { QUESTIONNAIRE_INSTRUMENT as instrument } from '../../src/domain/questionnaire-instrument-demo.js';
import { ImmersiveRun } from '../../src/experiment/immersive-run.js';
import { RunOrchestrator } from '../../src/experiment/run-orchestrator.js';
import { COLLECTION_MATERIAL } from '../../src/domain/collection-materials.js';
import { CONTRACT_VERSION, CLIENT_VERSION, type EntryCredential } from '@contracts';

it.skipIf(process.env.RUN_LOAD !== '1')(
  '50 isolated participants complete and survive restart',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'paper2-load50-'));
    const databasePath = path.join(directory, 'synthetic.sqlite');
    const plan = createExperimentPlan();
    const timings: { route: string; status: number; ms: number }[] = [];
    const failures: string[] = [];
    let child: ChildProcess | undefined;
    let base = '';
    let logs = '';
    let completed = 0;
    const started = performance.now();
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    async function start() {
      const socket = createServer();
      await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
      const port = (socket.address() as { port: number }).port;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      base = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, ['dist-server/main.js'], {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
          DATA_PATH: databasePath,
          ENTRY_CODE: 'SYNTHETIC-LOAD50',
          ADMIN_TOKEN: 'synthetic-load50-admin-only',
          STATIC_DIR: 'dist',
          NODE_ENV: 'test',
          SECURE_COOKIES: '0',
          PRACTICE_ROUNDS: '3',
          FORMAL_ROUNDS: '8',
        },
      });
      child.stdout?.on('data', (data) => {
        logs += String(data);
      });
      child.stderr?.on('data', (data) => {
        logs += String(data);
      });
      for (let attempt = 0; attempt < 200; attempt++) {
        if (child.exitCode !== null) throw new Error(logs);
        try {
          if ((await fetch(base + '/api/health')).ok) return;
        } catch {
          /* starting */
        }
        await pause(50);
      }
      throw new Error('Isolated load server did not start');
    }
    async function stop() {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      child = undefined;
    }
    const credential: EntryCredential = {
      entry_code: 'SYNTHETIC-LOAD50',
      observed_participation_mode: 'remote',
      observed_device_class: 'desktop',
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
    const clients = Array.from({ length: 50 }, (_, participant) => {
      let cookie = '';
      const fetchImpl: typeof fetch = async (input, init) => {
        const before = performance.now();
        const response = await fetch(base + String(input), {
          ...init,
          signal: AbortSignal.timeout(15000),
          headers: { ...init?.headers, connection: 'close', ...(cookie ? { cookie } : {}) },
        });
        // Include body transfer in latency; return a consumed-byte copy to the adapter.
        const body = await response.arrayBuffer();
        timings.push({
          route: String(input).split('?')[0]!,
          status: response.status,
          ms: performance.now() - before,
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) cookie = setCookie.split(';')[0]!;
        return new Response(body, { status: response.status, headers: response.headers });
      };
      const adapter = createRemoteAdapter({ fetchImpl, storage: null, entry, maxAttempts: 1 });
      const run = new ImmersiveRun(adapter, 'practice-trial-0', { credential });
      const flow = new RunOrchestrator(run, plan);
      return { participant, adapter, run, flow, fetchImpl };
    });
    try {
      await start();
      // No stagger and no retries: expose shared-IP admission failures directly.
      const admissions = await Promise.allSettled(
        clients.map(async ({ run, adapter, fetchImpl }) => {
          expect((await fetchImpl('/collect.html')).status).toBe(200);
          await adapter.validateEntryCode(credential.entry_code);
          await run.initialize({ version: entry.consent_version, acceptedAt: entry.accepted_at });
        }),
      );
      const rejected = admissions.filter((r) => r.status === 'rejected');
      failures.push(...rejected.map((r) => String(r.reason)));
      expect(rejected, 'All 50 participants must be admitted in one burst').toHaveLength(0);
      const results = await Promise.allSettled(
        clients.map(async ({ participant, adapter, run, flow }) => {
          for (const module of plan.modules) {
            if (module.kind === 'questionnaire') {
              for (const id of module.block_ids) {
                const block = instrument.blocks.find((b) => b.id === id)!;
                await run.submitQuestionnaireBlock({
                  block_id: id,
                  position: block.position,
                  instrument_version: instrument.version,
                  wording_profile: instrument.wordingProfile,
                  item_order: block.questions.map((q) => q.id),
                  responses: block.questions.map((q) => ({
                    item_id: q.id,
                    value:
                      q.kind === 'single_choice'
                        ? (q.correctAnswer ?? q.options[0]!.value)
                        : q.kind === 'text'
                          ? `synthetic-${participant}`
                          : q.min,
                    skipped: false,
                    response_ms: 100,
                  })),
                });
              }
            } else {
              await flow.enter(module.block);
              for (let round = 0; round < module.block.total_trials; round++) {
                await run.predict(participant % 2 ? 'B' : 'A', 50);
                const useAi = (participant + round) % 2 === 0;
                await run.chooseSource(useAi ? 'ai' : 'human');
                if (useAi) {
                  await run.markAdvicePresented();
                  run.chatCompleted = true;
                  run.finishChat();
                }
                await run.confirmFinal('C');
                const feedback = await run.startDraw();
                await run.presentFeedback(feedback);
                await flow.advance(module.block);
              }
            }
            // Refresh-equivalent authenticated reopen at every module boundary.
            const resumed = await adapter.sessionService.openSession(credential);
            expect(resumed.session_id).toBe(run.session.session_id);
          }
          const audit = {
            id: `synthetic-audit-${participant}`,
            type: 'load-test',
            at_ms: Date.now(),
            data: { simulation: true },
          };
          expect((await adapter.saveAudit([audit])).acknowledged_ids).toContain(audit.id);
          await adapter.saveAudit([audit]);
          await run.finish();
          expect(run.completed).toBe(true);
          const exported = await adapter.export();
          expect(exported.feedbacks).toHaveLength(11);
          expect(exported.trial_results).toHaveLength(11);
          expect(exported.presentation_audit).toHaveLength(1);
          expect(
            exported.events.filter((e) => e.event_type === 'questionnaire_block_submitted'),
          ).toHaveLength(6);
          expect(
            exported.events.filter((e) => e.event_type === 'prediction_submitted'),
          ).toHaveLength(11);
          expect(exported.events.every((e) => e.session_id === run.session.session_id)).toBe(true);
          expect(exported.events.map((e) => e.sequence_no)).toEqual(
            exported.events.map((_, i) => i),
          );
          expect(new Set(exported.events.map((e) => e.event_id)).size).toBe(exported.events.length);
          // Retry one confirmed event and verify exact durable equality after restart.
          const event = exported.events[0]!;
          const receipt = await adapter.resultStore.saveEvents(run.session, [event]);
          expect(receipt.rejected_events).toHaveLength(0);
          expect(receipt.acknowledged_event_ids).toContain(event.event_id);
          completed++;
          return exported;
        }),
      );
      failures.push(...results.filter((r) => r.status === 'rejected').map((r) => String(r.reason)));
      expect(completed, failures.join('\n')).toBe(50);
      expect(new Set(clients.map((c) => c.run.session.session_id)).size).toBe(50);
      await stop();
      await start();
      await Promise.all(
        clients.map(async ({ adapter }, index) => {
          expect((await adapter.snapshot()).completed).toBe(true);
          const original = results[index]!;
          if (original.status === 'fulfilled')
            expect(await adapter.export()).toEqual(original.value);
        }),
      );
      const response = await fetch(base + '/api/admin/export?format=csv', {
        headers: { authorization: 'Bearer synthetic-load50-admin-only' },
      });
      expect(response.status).toBe(200);
      expect((await response.text()).trim().split('\r\n')).toHaveLength(551);
      await stop();
      const { DatabaseSync } = createRequire(import.meta.url)(
        'node:sqlite',
      ) as typeof import('node:sqlite');
      const db = new DatabaseSync(databasePath, { readOnly: true });
      try {
        expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
        expect(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE completed=1').get()).toEqual({
          n: 50,
        });
        expect(
          db.prepare('SELECT COUNT(*) AS n FROM trial_access WHERE feedback_loaded=1').get(),
        ).toEqual({ n: 550 });
      } finally {
        db.close();
      }
      expect(timings.filter((t) => t.status >= 400)).toHaveLength(0);
      const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
      expect(sorted[Math.ceil(sorted.length * 0.95) - 1]).toBeLessThan(2000);
    } finally {
      await stop();
      mkdirSync('artifacts/qa', { recursive: true });
      const sorted = timings.map((t) => t.ms).sort((a, b) => a - b);
      const report = {
        at: new Date().toISOString(),
        node: process.version,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryGiB: totalmem() / 2 ** 30,
        participants: 50,
        completed,
        durationMs: performance.now() - started,
        requests: timings.length,
        httpErrors: timings.filter((t) => t.status >= 400).length,
        p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        p99Ms: sorted[Math.ceil(sorted.length * 0.99) - 1],
        maxMs: sorted.at(-1),
        databasePath,
        failures,
        timings,
      };
      writeFileSync('artifacts/qa/load-50-latest.json', JSON.stringify(report, null, 2));
      writeFileSync('artifacts/qa/load-50-server.log', logs);
      process.stdout.write(JSON.stringify({ ...report, timings: undefined }) + '\n');
    }
  },
  180000,
);
