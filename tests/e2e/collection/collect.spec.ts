// End-to-end acceptance for the collect.html data-collection flow against the
// real SQLite collection server. Each test boots its own in-process server on
// a system-assigned port with a temporary DATA_PATH (same pattern as
// tests/server/collection-server.spec.ts) and serves the built client from
// dist/, so `npm run build` must have run before this spec.
import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCollectionServer, type CollectionServer } from '../../../server/app.js';

const ENTRY_CODE = 'E2E-ENTRY-01';
const ADMIN_TOKEN = 'e2e-admin-token-0123456789abcdef';

interface ExportedEvent {
  event_id: string;
  sequence_no: number;
  event_type: string;
  payload: Record<string, unknown>;
}

interface SessionExport {
  completed: boolean;
  events: ExportedEvent[];
  entry: Record<string, unknown>;
  session: {
    session_id: string;
    participant_id: string;
    metadata: { participation_mode: string; device_class: string };
  };
  feedback: {
    actual_winner_machine_id: string;
    independent_correct: boolean;
    final_correct: boolean;
    points_awarded: number;
    advice_evaluation: Record<string, unknown>;
  } | null;
}

interface AdminExport {
  simulation: boolean;
  sessions: SessionExport[];
}

let server: CollectionServer;
let dataDir = '';
let baseUrl = '';

test.beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'collect-e2e-'));
  server = createCollectionServer({
    databasePath: path.join(dataDir, 'collection.sqlite'),
    entryCode: ENTRY_CODE,
    adminToken: ADMIN_TOKEN,
    staticDir: path.resolve('dist'),
    secureCookies: false,
  });
  await new Promise<void>((resolve) => server.server.listen(0, '127.0.0.1', resolve));
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('server has no address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterEach(async () => {
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function enterAccess(page: Page, entryCode: string): Promise<void> {
  await page.goto(`${baseUrl}/collect.html`);
  await expect(page.getByRole('heading', { name: '输入参与码，选择参与方式。' })).toBeVisible();
  await page.getByLabel('参与码', { exact: true }).fill(entryCode);
  await page.locator('input[value="remote"]').check();
  await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
}

async function completeConsent(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: '预测任务参与知情同意书（数据收集试点）' }),
  ).toBeVisible();
  const accept = page.getByRole('button', { name: /同意并查看操作说明/ });
  await expect(accept).toBeDisabled();
  const checks = page.locator('.consent-checks input[type="checkbox"]');
  const count = await checks.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    await expect(checks.nth(i)).not.toBeChecked();
    await checks.nth(i).check();
  }
  await accept.click();
  await expect(page.getByRole('heading', { name: '一次预测，分三步完成。' })).toBeVisible();
}

async function enter(page: Page): Promise<void> {
  await enterAccess(page, ENTRY_CODE);
  await completeConsent(page);
  await page.getByRole('button', { name: /开始实验/ }).click();
  await expect(page.getByRole('button', { name: '选择机器 A', exact: true })).toBeVisible();
}

async function submitIndependent(page: Page, machine: string): Promise<void> {
  await page.getByRole('button', { name: `选择机器 ${machine}`, exact: true }).click();
  await page.getByRole('button', { name: /确认独立预测/ }).click();
  await expect(page.getByRole('button', { name: /依据自己判断/ })).toBeVisible();
}

async function readAdvice(page: Page): Promise<void> {
  await page.getByRole('button', { name: /参考 AI 建议/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const back = page.getByRole('button', { name: /返回并确认最终预测/ });
  await expect(back).toBeDisabled();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.answer-text').first()).toContainText('我的建议');
  await expect(back).toBeEnabled({ timeout: 20_000 });
  await back.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function finalizeAndWaitDone(page: Page, machine: string): Promise<void> {
  await page.getByRole('button', { name: `选择机器 ${machine}`, exact: true }).click();
  await page.getByRole('button', { name: /锁定最终预测/ }).click();
  await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
  await expect(page.locator('.result-card')).toContainText('机器 C 中奖');
  await expect(page.locator('#step-label')).toHaveText('本轮完成', { timeout: 20_000 });
}

async function exportOwn(page: Page): Promise<SessionExport> {
  const response = await page.request.get(`${baseUrl}/api/export`);
  expect(response.status()).toBe(200);
  return (await response.json()) as SessionExport;
}

async function adminExport(page: Page, token?: string): Promise<AdminExport> {
  const response = await page.request.get(`${baseUrl}/api/admin/export`, {
    headers: token === undefined ? {} : { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as AdminExport;
}

function expectNoDuplicateEvents(events: ExportedEvent[]): void {
  expect(new Set(events.map((event) => event.event_id)).size).toBe(events.length);
  expect(new Set(events.map((event) => event.sequence_no)).size).toBe(events.length);
}

test('correct entry code passes consent and instructions gating into the trial', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${baseUrl}/collect.html`);

  // Access step: the continue button stays disabled until a plausible code.
  const next = page.getByRole('button', { name: /继续阅读知情同意/ });
  await expect(next).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  await page.getByLabel('参与码', { exact: true }).fill(ENTRY_CODE);
  await page.locator('input[value="remote"]').check();
  await next.click();

  // Consent: nothing pre-checked, accept disabled until every box is ticked.
  await completeConsent(page);

  // Instructions: no trial UI before the explicit start.
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  await page.getByRole('button', { name: /开始实验/ }).click();
  await expect(page.getByRole('button', { name: '选择机器 A', exact: true })).toBeVisible();

  // The session now exists server-side and records the observed mode/device.
  const snapshot = await page.request.get(`${baseUrl}/api/session`);
  expect(snapshot.status()).toBe(200);
  const body = (await snapshot.json()) as SessionExport;
  expect(body.completed).toBe(false);
  expect(body.session.metadata.participation_mode).toBe('remote');
  expect(body.session.metadata.device_class).toBe('desktop');
  expect(errors).toEqual([]);
});

test('full AI-branch trial: advice, final answer, feedback and durable finish', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await submitIndependent(page, 'A');
  await readAdvice(page);
  await finalizeAndWaitDone(page, 'B');

  const data = await exportOwn(page);
  expect(data.completed).toBe(true);
  expect(data.events.map((event) => event.event_type)).toEqual([
    'consent_recorded',
    'prediction_submitted',
    'confidence_submitted',
    'source_selected',
    'advice_revealed',
    'final_prediction_submitted',
    'feedback_presented',
    'session_completion_requested',
  ]);
  expectNoDuplicateEvents(data.events);
  expect(data.entry.consent_version).toBe('collect-consent-2026-09-19-v1');
  expect(data.entry).not.toHaveProperty('entry_code');
  expect(data.feedback).not.toBeNull();
  if (!data.feedback) throw new Error('feedback missing');
  expect(data.feedback.actual_winner_machine_id).toBe('C');
  expect(data.feedback.independent_correct).toBe(false);
  expect(data.feedback.final_correct).toBe(false);
  expect(data.feedback.points_awarded).toBe(0);
  expect(data.feedback.advice_evaluation).toMatchObject({
    advice_exposed: true,
    advice_correct: false,
    final_matches_advice: true,
    switched_to_advice: true,
  });
  expect(errors).toEqual([]);
});

test('reload mid-trial restores server progress and never duplicates events', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await submitIndependent(page, 'A');

  // Reload after the independent prediction is locked: the source-choice stage
  // must be restored from the server without asking again.
  await page.reload();
  await expect(page.getByRole('button', { name: /依据自己判断/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 B', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: /依据自己判断/ }).click();
  await finalizeAndWaitDone(page, 'C');

  const data = await exportOwn(page);
  expect(data.completed).toBe(true);
  expect(data.events).toHaveLength(7);
  expectNoDuplicateEvents(data.events);
  expect(data.events.filter((event) => event.event_type === 'prediction_submitted')).toHaveLength(
    1,
  );
  expect(data.events[1]?.payload.machine_id).toBe('A');
  expect(data.feedback?.final_correct).toBe(true);
  expect(data.feedback?.points_awarded).toBe(10);
  expect(data.feedback?.advice_evaluation.advice_exposed).toBe(false);

  // A second reload after completion still shows the finished state.
  await page.reload();
  await expect(page.locator('#step-label')).toHaveText('本轮完成');
  const again = await exportOwn(page);
  expect(again.events.map((event) => event.event_id)).toEqual(
    data.events.map((event) => event.event_id),
  );
  expect(errors).toEqual([]);
});

test('wrong entry code is rejected and creates no session', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enterAccess(page, 'WRONG-CODE-9');
  await completeConsent(page);
  await page.getByRole('button', { name: /开始实验/ }).click();

  await expect(page.getByRole('alert')).toContainText('入场码无效');
  await expect(page.getByRole('button', { name: /重试进入实验/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);

  // No cookie, no session, nothing persisted.
  const snapshot = await page.request.get(`${baseUrl}/api/session`);
  expect(snapshot.status()).toBe(401);
  const admin = await adminExport(page, ADMIN_TOKEN);
  expect(admin.sessions).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('admin export returns the finished session only with the admin token', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await enter(page);
  await submitIndependent(page, 'A');
  await page.getByRole('button', { name: /依据自己判断/ }).click();
  await finalizeAndWaitDone(page, 'C');
  const own = await exportOwn(page);

  const noToken = await page.request.get(`${baseUrl}/api/admin/export`);
  expect(noToken.status()).toBe(401);
  const wrongToken = await page.request.get(`${baseUrl}/api/admin/export`, {
    headers: { Authorization: 'Bearer not-the-admin-token' },
  });
  expect(wrongToken.status()).toBe(401);

  const adminResponse = await page.request.get(`${baseUrl}/api/admin/export`, {
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  expect(adminResponse.status()).toBe(200);
  const admin = (await adminResponse.json()) as AdminExport;
  expect(admin.simulation).toBe(true);
  expect(admin.sessions).toHaveLength(1);
  const shape = admin.sessions[0];
  if (!shape) throw new Error('session missing from admin export');
  expect(shape.session.session_id).toBe(own.session.session_id);
  expect(shape.session.participant_id).toBe(own.session.participant_id);
  expect(shape.completed).toBe(true);
  expect(shape.events.map((event) => event.event_id)).toEqual(
    own.events.map((event) => event.event_id),
  );
  expect(shape.feedback).toEqual(own.feedback);

  // Secrets never leave the server through the export.
  const raw = JSON.stringify(admin);
  expect(raw).not.toContain(ADMIN_TOKEN);
  expect(raw).not.toContain(ENTRY_CODE);
  expect(raw).not.toContain('token_hash');
  expect(errors).toEqual([]);
});
