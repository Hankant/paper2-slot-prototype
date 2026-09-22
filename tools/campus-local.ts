/**
 * Campus-LAN collection mode: same pilot server as collect:local, but bound to
 * 0.0.0.0 so phones/computers on the campus network can reach this machine.
 * Data and credentials stay in the same ignored private/collection directory.
 * Only for on-campus pilot sessions; not a public deployment.
 */
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const settingsFile = path.resolve('private/collection/local-settings.json');
if (!existsSync(settingsFile)) throw new Error('请先执行一次 npm run collect:local 生成本机设置');
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
if (!existsSync('dist-server/main.js')) throw new Error('请先执行 npm run build:all');

const lanUrls: string[] = [];
for (const [name, addresses] of Object.entries(networkInterfaces())) {
  for (const address of addresses ?? []) {
    if (address.family === 'IPv4' && !address.internal) {
      lanUrls.push(`http://${address.address}:${settings.port}/collect.html  (${name})`);
    }
  }
}
if (lanUrls.length === 0) throw new Error('没有找到可用的局域网地址，请确认已连接校园网');

Object.assign(process.env, {
  HOST: '0.0.0.0',
  PORT: String(settings.port),
  DATA_PATH: path.resolve('private/collection/collection.sqlite'),
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
  `校内采集模式（仅限同一校园网访问，不是公网地址）\n` +
    `参与链接：\n${lanUrls.map((url) => `  ${url}`).join('\n')}\n` +
    `参与码：${settings.entryCode}\n` +
    `把链接粘到任意离线二维码工具即可生成现场二维码；IP 变化后重跑本命令获取新链接。\n` +
    `首次运行如弹出 Windows 防火墙提示，请允许"专用网络"访问。\n`,
);
await import(new URL('../dist-server/main.js', import.meta.url).href);
