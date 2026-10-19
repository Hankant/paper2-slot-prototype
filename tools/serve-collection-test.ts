import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
mkdirSync('artifacts/collection-tests', { recursive: true });
const folder = mkdtempSync(path.resolve('artifacts/collection-tests/run-'));
Object.assign(process.env, {
  PRACTICE_ROUNDS: '2',
  FORMAL_ROUNDS: '3',
  REWARD_PER_POINT_CNY: '0.2', // Synthetic test ratio; never used by the campus server.
  HOST: '127.0.0.1',
  PORT: '5218',
  DATA_PATH: path.join(folder, 'test.sqlite'),
  ENTRY_CODE: 'PAPER2-TEST',
  ADMIN_TOKEN: 'synthetic-test-admin-only',
  SECURE_COOKIES: 'false',
  NODE_ENV: 'test',
});
await import(new URL('../dist-server/main.js', import.meta.url).href);
