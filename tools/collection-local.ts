/** Local-only pilot operations. Credentials and data stay in ignored private/. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

const action = process.argv[2] ?? 'start';
if (!['start', 'export', 'backup'].includes(action)) throw new Error('Use start, export or backup');
const privateDir = path.resolve('private/collection');
const settingsFile = path.join(privateDir, 'local-settings.json');
if (!existsSync(settingsFile)) {
  if (action !== 'start') throw new Error('请先执行 npm run collect:local');
  mkdirSync(privateDir, { recursive: true });
  writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        entryCode: 'PAPER2-LOCAL',
        adminToken: randomBytes(32).toString('hex'),
        port: 5200,
        humanAverageHitRate: 0.55,
        aiHitRate: 0.6,
        aiAccuracyTier: 'plus_5pp',
        pointsPerCorrect: 10,
        rewardPerPointCny: null,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
}
const settings = JSON.parse(readFileSync(settingsFile, 'utf8')) as {
  entryCode: string;
  adminToken: string;
  port: number;
  humanAverageHitRate?: number;
  aiHitRate?: number;
  aiAccuracyTier?: string;
  pointsPerCorrect?: number;
  rewardPerPointCny?: number | null;
};
const databasePath = path.join(privateDir, 'collection.sqlite');
const baseUrl = `http://127.0.0.1:${settings.port}`;
if (action === 'start') {
  if (!existsSync('dist-server/main.js')) throw new Error('请先执行 npm run build:all');
  Object.assign(process.env, {
    HOST: '127.0.0.1',
    PORT: String(settings.port),
    DATA_PATH: databasePath,
    ENTRY_CODE: settings.entryCode,
    ADMIN_TOKEN: settings.adminToken,
    STATIC_DIR: path.resolve('dist'),
    SECURE_COOKIES: 'false',
    NODE_ENV: 'development',
    HUMAN_AVERAGE_HIT_RATE: String(settings.humanAverageHitRate ?? 0.55),
    AI_HIT_RATE: String(settings.aiHitRate ?? 0.6),
    AI_ACCURACY_TIER: settings.aiAccuracyTier ?? 'plus_5pp',
    POINTS_PER_CORRECT: String(settings.pointsPerCorrect ?? 10),
    REWARD_PER_POINT_CNY:
      settings.rewardPerPointCny === null || settings.rewardPerPointCny === undefined
        ? ''
        : String(settings.rewardPerPointCny),
  });
  process.stdout.write(
    `本机采集试点：${baseUrl}/collect.html\n参与码保存在 private/collection/local-settings.json；首次默认 PAPER2-LOCAL。\n`,
  );
  await import(new URL('../dist-server/main.js', import.meta.url).href);
} else {
  const folder = path.join(privateDir, action === 'export' ? 'exports' : 'backups');
  mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8);
  if (action === 'export') {
    for (const format of ['json', 'csv']) {
      const response = await fetch(
        `${baseUrl}/api/admin/export${format === 'csv' ? '?format=csv' : ''}`,
        {
          headers: { Authorization: `Bearer ${settings.adminToken}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok) throw new Error(`导出失败：HTTP ${response.status}`);
      const output = path.join(folder, `${stamp}.${format}`);
      writeFileSync(output, await response.text(), { flag: 'wx', mode: 0o600 });
      process.stdout.write(`已导出：${output}\n`);
    }
  } else {
    if (!existsSync(databasePath)) throw new Error('数据库尚不存在');
    const { DatabaseSync } = createRequire(import.meta.url)(
      'node:sqlite',
    ) as typeof import('node:sqlite');
    const output = path.join(folder, `${stamp}.sqlite`);
    const db = new DatabaseSync(databasePath);
    try {
      db.prepare('VACUUM INTO ?').run(output);
    } finally {
      db.close();
    }
    const backup = new DatabaseSync(output, { readOnly: true });
    try {
      const result = backup.prepare('PRAGMA integrity_check').get();
      if (result?.integrity_check !== 'ok') throw new Error('备份完整性校验失败');
    } finally {
      backup.close();
    }
    process.stdout.write(`备份完整性校验通过：${output}\n`);
  }
}
