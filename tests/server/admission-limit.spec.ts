// @vitest-environment node
import { expect, it } from 'vitest';
import { createCollectionServer } from '../../server/app.js';

it('keeps a bounded shared-address admission limit and does not trust forwarded IPs', async () => {
  const service = createCollectionServer({
    databasePath: ':memory:',
    entryCode: 'SYNTHETIC-LIMIT',
    adminToken: 'synthetic-admin-limit',
  });
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(service.server.address() as { port: number }).port}`;
  try {
    for (let i = 0; i < 120; i++) {
      const response = await fetch(base + '/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: '{}',
      });
      expect(response.status).toBe(400);
      await response.text();
    }
    const response = await fetch(base + '/api/session', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        connection: 'close',
        'x-forwarded-for': '192.0.2.5',
      },
      body: '{}',
    });
    expect(response.status).toBe(429);
    await response.text();
  } finally {
    await service.close();
  }
});
