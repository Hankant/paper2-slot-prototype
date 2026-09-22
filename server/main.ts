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
const HUMAN_AVERAGE_HIT_RATE = Number(process.env.HUMAN_AVERAGE_HIT_RATE ?? '0.55');
const AI_HIT_RATE = Number(process.env.AI_HIT_RATE ?? '0.60');
const AI_ACCURACY_TIER = process.env.AI_ACCURACY_TIER ?? 'plus_5pp';
const POINTS_PER_CORRECT = Number(process.env.POINTS_PER_CORRECT ?? '10');
const REWARD_PER_POINT_CNY =
  process.env.REWARD_PER_POINT_CNY === undefined || process.env.REWARD_PER_POINT_CNY === ''
    ? null
    : Number(process.env.REWARD_PER_POINT_CNY);
const CONDITION_ID =
  process.env.CONDITION_ID ??
  `human-${Math.round(HUMAN_AVERAGE_HIT_RATE * 100)}_ai-${Math.round(AI_HIT_RATE * 100)}`;

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
if (HUMAN_AVERAGE_HIT_RATE < 0 || HUMAN_AVERAGE_HIT_RATE > 1)
  fail('HUMAN_AVERAGE_HIT_RATE must be between 0 and 1');
if (AI_HIT_RATE < 0 || AI_HIT_RATE > 1) fail('AI_HIT_RATE must be between 0 and 1');
if (!Number.isInteger(POINTS_PER_CORRECT) || POINTS_PER_CORRECT < 0)
  fail('POINTS_PER_CORRECT must be a non-negative integer');
if (
  REWARD_PER_POINT_CNY !== null &&
  (!Number.isFinite(REWARD_PER_POINT_CNY) || REWARD_PER_POINT_CNY < 0)
)
  fail('REWARD_PER_POINT_CNY must be a non-negative number');

const databasePath = path.resolve(DATA_PATH);
mkdirSync(path.dirname(databasePath), { recursive: true });

const { server, close } = createCollectionServer({
  databasePath,
  entryCode: ENTRY_CODE,
  adminToken: ADMIN_TOKEN,
  staticDir: path.resolve(STATIC_DIR),
  secureCookies: SECURE_COOKIES,
  performanceReference: {
    condition_id: CONDITION_ID,
    human_average_hit_rate: HUMAN_AVERAGE_HIT_RATE,
    ai_hit_rate: AI_HIT_RATE,
    ai_accuracy_tier: AI_ACCURACY_TIER,
    points_per_correct: POINTS_PER_CORRECT,
    reward_per_point_cny: REWARD_PER_POINT_CNY,
  },
  practiceRequired: true,
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
