// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollectionServer } from '../../server/app.js';
import { createExperimentPlan } from '../../src/domain/experiment-plan.js';

it('persists config revisions across restart and rejects invalid plans and cross-origin writes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'paper2-admin-'));
  const options = {
    databasePath: path.join(directory, 'test.sqlite'),
    entryCode: 'TEST-ADMIN',
    adminToken: 'synthetic-admin-token',
    experimentPlan: createExperimentPlan(2, 3),
  };
  let server = createCollectionServer(options),
    base = '';
  const listen = async () => {
    await new Promise<void>((resolve) => server.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + (server.server.address() as { port: number }).port;
  };
  const headers = {
    Authorization: 'Bearer synthetic-admin-token',
    'Content-Type': 'application/json',
    connection: 'close',
  };
  await listen();
  try {
    const initial = await (await fetch(base + '/api/admin/config', { headers })).json();
    const changed = structuredClone(initial.config);
    changed.name = 'persistent configuration';
    changed.conditions[0].ai_hit_rate = 0.8;
    expect(
      (
        await fetch(base + '/api/admin/config', {
          method: 'POST',
          headers: { ...headers, Origin: 'https://unrelated.example' },
          body: JSON.stringify({ expected_revision: initial.revision, config: changed }),
        })
      ).status,
    ).toBe(403);
    const invalid = structuredClone(changed);
    invalid.plan.modules[0].block.scores_excluded_from_formal = false;
    expect(
      (
        await fetch(base + '/api/admin/config', {
          method: 'POST',
          headers,
          body: JSON.stringify({ expected_revision: initial.revision, config: invalid }),
        })
      ).status,
    ).toBe(400);
    const saved = await (
      await fetch(base + '/api/admin/config', {
        method: 'POST',
        headers,
        body: JSON.stringify({ expected_revision: initial.revision, config: changed }),
      })
    ).json();
    expect(saved.revision).toBe(initial.revision + 1);
    await server.close();
    server = createCollectionServer({ ...options, experimentPlan: createExperimentPlan(1, 1) });
    await listen();
    const restored = await (await fetch(base + '/api/admin/config', { headers })).json();
    expect(restored.config).toEqual(changed);
    expect(restored.revision).toBe(saved.revision);
  } finally {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
