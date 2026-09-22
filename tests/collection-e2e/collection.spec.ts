import { test, expect, type Page } from '@playwright/test';
import { completePostQuestionnaires, completePreQuestionnaires } from '../helpers/questionnaire.js';
import { completePractice } from '../helpers/practice.js';
async function enter(page: Page) {
  await page.goto('/collect.html');
  await page.getByLabel('参与码', { exact: true }).fill('PAPER2-TEST');
  await page.locator('input[value="remote"]').check();
  await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
  const checks = page.getByRole('checkbox');
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).check();
  await page.getByRole('button', { name: /同意并查看操作说明/ }).click();
  await page.getByRole('button', { name: /开始实验/ }).click();
  await completePractice(page);
  await completePreQuestionnaires(page);
  await expect(page.getByRole('button', { name: '选择机器 A', exact: true })).toBeVisible();
}
async function predict(page: Page) {
  await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
  await page.getByRole('button', { name: /确认独立预测/ }).click();
  await expect(page.getByRole('button', { name: /依据自己判断/ })).toBeVisible();
}
async function finalize(page: Page, id: string) {
  await page.getByRole('button', { name: `选择机器 ${id}`, exact: true }).click();
  await page.getByRole('button', { name: /锁定最终预测/ }).click();
  await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
  await completePostQuestionnaires(page);
}
for (const width of [1280, 390])
  test(`self branch durable export and completed reload ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await enter(page);
    await predict(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /依据自己判断/ })).toBeVisible();
    await page.getByRole('button', { name: /依据自己判断/ }).click();
    await finalize(page, 'C');
    await expect(page.locator('#step-label')).toHaveText('本轮完成');
    const before = await (await page.request.get('/api/export')).json();
    expect(before.completed).toBe(true);
    expect(before.events).toHaveLength(14);
    expect(before.events[1]).toMatchObject({
      event_type: 'practice_completed',
      payload: { human_average_hit_rate: 0.55, ai_hit_rate: 0.6, total_points: 20 },
    });
    expect(before.feedback.final_correct).toBe(true);
    expect(before.feedback.advice_evaluation.advice_exposed).toBe(false);
    expect(before.entry).not.toHaveProperty('entry_code');
    expect(before.session.metadata.participation_mode).toBe('remote');
    expect(new Set(before.presentation_audit.map((r: { id: string }) => r.id)).size).toBe(
      before.presentation_audit.length,
    );
    await page.reload();
    await expect(page.locator('#step-label')).toHaveText('本轮完成');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载本轮记录/ }).click();
    await (await download).saveAs(`artifacts/collection-tests/export-${width}.json`);
    expect(await page.locator('body').evaluate((e) => e.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/qa/collection-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
test('lost write acknowledgement then reload retries original event IDs, without changing answer', async ({
  page,
}) => {
  await enter(page);
  let lose = true;
  await page.route('**/api/events', async (route) => {
    const body = route.request().postDataJSON();
    if (
      lose &&
      body.events.some((e: { event_type: string }) => e.event_type === 'prediction_submitted')
    ) {
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
  await page.getByRole('button', { name: /确认独立预测/ }).click();
  await expect(page.getByRole('alert')).not.toBeEmpty();
  lose = false;
  await page.reload();
  await expect(page.getByRole('button', { name: /确认独立预测/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 B', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: /确认独立预测/ }).click();
  await expect(page.getByRole('button', { name: /依据自己判断/ })).toBeVisible();
  const data = await (await page.request.get('/api/export')).json();
  expect(
    data.events.filter((e: { event_type: string }) => e.event_type === 'prediction_submitted'),
  ).toHaveLength(1);
  expect(
    data.events.find((event: { event_type: string }) => event.event_type === 'prediction_submitted')
      .payload.machine_id,
  ).toBe('A');
});
test('AI reload before advice, streamed answer, failed finish stays pending and retries', async ({
  page,
}) => {
  await enter(page);
  await predict(page);
  await page.getByRole('button', { name: /参考 AI 建议/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /继续与助手对话/ }).click();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  const back = page.getByRole('button', { name: /返回并确认最终预测/ });
  await expect(back).toBeEnabled({ timeout: 20000 });
  await back.click();
  let fail = true;
  await page.route('**/api/finish', async (route) =>
    fail
      ? route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'NETWORK_UNAVAILABLE', message: '模拟提交失败' } }),
        })
      : route.continue(),
  );
  await finalize(page, 'B');
  await expect(page.locator('#step-label')).toHaveText('等待保存确认');
  await expect(page.getByRole('button', { name: /重新体验/ })).toHaveCount(0);
  fail = false;
  await page.getByRole('button', { name: '重试保存并完成' }).click();
  await expect(page.locator('#step-label')).toHaveText('本轮完成');
  const data = await (await page.request.get('/api/export')).json();
  expect(data.completed).toBe(true);
  expect(data.events).toHaveLength(15);
  expect(
    data.presentation_audit.some((a: { type: string }) => a.type === 'chat_display_completed'),
  ).toBe(true);
  expect(
    data.presentation_audit.some(
      (a: { type: string }) => a.type === 'chat_represented_after_reload',
    ),
  ).toBe(true);
  const admin = await (
    await page.request.get('/api/admin/export', {
      headers: { Authorization: 'Bearer synthetic-test-admin-only' },
    })
  ).json();
  const match = admin.sessions.find(
    (s: { session: { session_id: string } }) => s.session.session_id === data.session.session_id,
  );
  expect(match.events).toEqual(data.events);
  expect(match.feedback).toEqual(data.feedback);
});
