import { test, expect, type Page } from '@playwright/test';
import { enterBlock, rounds, selfRound, nextRound } from '../helpers/multi-round.js';
import { completeQuestionnaireBlock } from '../helpers/questionnaire.js';

async function entry(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/collect.html');
  await page.getByLabel('参与码', { exact: true }).fill('PAPER2-TEST');
  await page.locator('input[value="remote"]').check();
  await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  for (const check of await page.getByRole('checkbox').all()) await check.check();
  await page.getByRole('button', { name: /同意并查看操作说明/ }).click();
  await page.getByRole('button', { name: /开始实验/ }).click();
  await expect(page.getByRole('button', { name: /开始试玩/ })).toBeVisible();
}

test('practice hides rewards; questionnaire reload preserves order, answers and wrong attempts', async ({
  page,
}) => {
  await entry(page);
  await enterBlock(page);
  await expect(page.locator('.practice-persistent-banner')).toContainText('试玩环节');
  await expect(page.locator('.score-counter')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/qa/practice-no-points.png', fullPage: true });
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('.practice-persistent-banner')).toBeVisible();
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'artifacts/qa/practice-no-points-mobile.png',fullPage:true});
  await page.setViewportSize({width:1280,height:850});
  await expect(page.locator('body')).not.toContainText('积分');
  await selfRound(page);
  await expect(page.locator('body')).not.toContainText('积分');
  await expect(page.locator('body')).not.toContainText('¥');
  await nextRound(page);
  await rounds(page, 1);
  const items = page.locator('[data-block-id="pre-prior-beliefs"] [data-item-id]');
  const order = await items.evaluateAll((nodes) =>
    nodes.map((n) => (n as HTMLElement).dataset.itemId),
  );
  await page.locator('[data-question-id="PRE_PRIOR_ACC_SELF"]').fill('73');
  await page.reload();
  await expect(page.locator('[data-question-id="PRE_PRIOR_ACC_SELF"]')).toHaveValue('73');
  expect(
    await items.evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.itemId)),
  ).toEqual(order);
  let rejected = 0;
  await page.route('**/api/events', async (route) => {
    const body = route.request().postDataJSON();
    const event = body.events.find(
      (e: { event_type: string; payload: { block_id?: string } }) =>
        e.event_type === 'questionnaire_block_submitted' &&
        e.payload.block_id === 'pre-prior-beliefs',
    );
    if (event) {
      event.payload.responses[0].value = 101;
      const invalid = await page.request.post('/api/events', { data: body });
      const receipt = await invalid.json();
      expect(receipt.acknowledged_event_ids).not.toContain(event.event_id);
      expect(receipt.rejected_events).toHaveLength(1);
      const stored = await (await page.request.get('/api/export')).json();
      expect(stored.events.some((e: { event_id: string }) => e.event_id === event.event_id)).toBe(
        false,
      );
      rejected++;
    }
    await route.continue();
  });
  await completeQuestionnaireBlock(page, 'pre-prior-beliefs');
  expect(rejected).toBe(1);
  await page.unroute('**/api/events');
  await page.locator('input[value="historical_best"]').check();
  await page.locator('[data-block-id="pre-comprehension"] button[type="submit"]').click();
  await page.reload();
  await expect(page.locator('input[value="historical_best"]')).toBeChecked();
  await completeQuestionnaireBlock(page, 'pre-comprehension');
  const data = await (await page.request.get('/api/export')).json();
  expect(
    data.events.find(
      (e: { event_type: string; payload: { block_id?: string } }) =>
        e.event_type === 'questionnaire_block_submitted' &&
        e.payload.block_id === 'pre-comprehension',
    ).payload.comprehension_errors,
  ).toEqual([{ item_id: 'COMP_TARGET', incorrect_count: 1 }]);
  await enterBlock(page);
  await expect(page.locator('.practice-persistent-banner')).toHaveCount(0);
  await expect(page.locator('.score-counter')).toBeVisible();
});

test('admin authorization, publish, frozen existing session, filter and export', async ({
  page,
  context,
}) => {
  const headers = { Authorization: 'Bearer synthetic-test-admin-only' };
  expect((await page.request.get('/api/admin/config')).status()).toBe(401);
  const original = await (await page.request.get('/api/admin/config', { headers })).json();
  try {
    await entry(page);
    const old = await (await page.request.get('/api/export')).json();
    const admin = await context.newPage();
    await admin.goto('/admin.html');
    await admin.getByLabel('管理员密钥').fill('synthetic-test-admin-only');
    await admin.getByRole('button', { name: '进入控制台' }).click();
    await expect(admin.locator('#flow .flow-row')).toHaveCount(4);
    await admin.getByLabel('上移模块 2').click();
    await admin.locator('[data-round="1"]').fill('4');
    await admin.getByLabel('reward_per_point_cny 1', { exact: true }).fill('0.2');
    await admin.getByRole('button', { name: '添加条件' }).click();
    await admin.getByLabel('ai_hit_rate 2', { exact: true }).fill('40');
    await admin.getByRole('button', { name: '发布配置（仅新会话）' }).click();
    await expect(admin.locator('#notice')).toContainText('已发布');
    const published = await (await admin.request.get('/api/admin/config', { headers })).json();
    expect(published.revision).toBe(original.revision + 1);
    expect(published.config.plan.modules[0].kind).toBe('questionnaire');
    expect(published.config.conditions[1].ai_hit_rate).toBe(0.4);
    expect((await (await page.request.get('/api/export')).json()).session).toEqual(old.session);
    const conflict = await admin.request.post('/api/admin/config', {
      headers,
      data: { expected_revision: original.revision, config: original.config },
    });
    expect(conflict.status()).toBe(409);
    await admin.locator('#search').fill(old.session.session_id);
    await expect(admin.locator('#sessions tr')).toHaveCount(1);
    const download = admin.waitForEvent('download');
    await admin.locator('#json').click();
    expect((await download).suggestedFilename()).toContain('.json');
    await admin.screenshot({ path: 'artifacts/qa/admin-console.png', fullPage: true });
    const freshContext = await context.browser()!.newContext();
    const fresh = await freshContext.newPage();
    // New context isolates the participant cookie; use the same absolute origin.
    await fresh.goto(new URL('/collect.html', page.url()).href);
    await fresh.getByLabel('参与码', { exact: true }).fill('PAPER2-TEST');
    await fresh.locator('input[value="remote"]').check();
    await fresh.getByRole('button', { name: /继续阅读知情同意/ }).click();
    await expect(fresh.getByRole('checkbox').first()).toBeVisible();
    for (const check of await fresh.getByRole('checkbox').all()) await check.check();
    await fresh.getByRole('button', { name: /同意并查看操作说明/ }).click();
    await fresh.getByRole('button', { name: /开始实验/ }).click();
    await expect(fresh.locator('[data-block-id="pre-prior-beliefs"]')).toBeVisible();
    const next = await (await fresh.request.get(new URL('/api/export', page.url()).href)).json();
    expect(next.session.configuration_revision).toBe(published.revision);
    expect(next.session.assignment_method).toBe('equal_random');
    expect(next.session.experiment_plan).toEqual(published.config.plan);
    await freshContext.close();
  } finally {
    const latest = await (await page.request.get('/api/admin/config', { headers })).json();
    const restored = await page.request.post('/api/admin/config', {
      headers,
      data: { expected_revision: latest.revision, config: original.config },
    });
    expect(restored.status()).toBe(200);
  }
});
