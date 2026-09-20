/**
 * Production entry for the collection server (see .agents/architecture.md).
 * Build target: dist-server/main.js on Node 24. No baked-in credentials.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createCollectionServer } from './app.js';

const HOST = process.env.HOST ?? '127.0.0.1';
const PORT = Number(process.env.PORT ?? '5200');
const DATA_PATH = process.env.DATA_PATH ?? 'data/collection.sqlite';
const ENTRY_CODE = process.env.ENTRY_CODE;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const STATIC_DIR = process.env.STATIC_DIR ?? 'dist';
const SECURE_COOKIES = ['1', 'true', 'yes'].includes(
  (process.env.SECURE_COOKIES ?? '').trim().toLowerCase(),
);

function fail(message: string): never {
  console.error(`[collection-server] ${message}`);
  process.exit(1);
}

if (!ENTRY_CODE) fail('ENTRY_CODE is required (entry code for this collection batch)');
if (!ADMIN_TOKEN) fail('ADMIN_TOKEN is required (admin Bearer token for export)');
if (process.env.NODE_ENV === 'production' && !SECURE_COOKIES) {
  fail('NODE_ENV=production requires SECURE_COOKIES=1');
}
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) fail('PORT must be a valid port number');

const databasePath = path.resolve(DATA_PATH);
mkdirSync(path.dirname(databasePath), { recursive: true });

const { server, close } = createCollectionServer({
  databasePath,
  entryCode: ENTRY_CODE,
  adminToken: ADMIN_TOKEN,
  staticDir: path.resolve(STATIC_DIR),
  secureCookies: SECURE_COOKIES,
});

server.listen(PORT, HOST, () => {
  process.stdout.write(
    `[collection-server] listening on http://${HOST}:${PORT} (sqlite: ${databasePath})\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
