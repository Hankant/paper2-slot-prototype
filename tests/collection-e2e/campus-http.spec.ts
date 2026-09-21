import { test, expect } from '@playwright/test';
import { completePostQuestionnaires, completePreQuestionnaires } from '../helpers/questionnaire.js';

for (const source of ['human', 'ai'] as const) {
  test(`non-secure HTTP ${source}: consent, prediction, completion, reload and export`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/collect.html');
    // No stubs or secure-origin flags: browser must really disable these APIs.
    expect(
      await page.evaluate(() => ({
        secure: isSecureContext,
        uuid: typeof crypto.randomUUID,
        subtle: typeof crypto.subtle,
        random: typeof crypto.getRandomValues,
      })),
    ).toEqual({ secure: false, uuid: 'undefined', subtle: 'undefined', random: 'function' });
    await page.getByLabel('参与码', { exact: true }).fill('PAPER2-TEST');
    await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
    for (const check of await page.getByRole('checkbox').all()) await check.check();
    await page.getByRole('button', { name: /同意并查看操作说明/ }).click();
    await page.getByRole('button', { name: /开始实验/ }).click();
    await completePreQuestionnaires(page);
    await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
    await page.getByRole('button', { name: /确认独立预测/ }).click();
    await page
      .getByRole('button', { name: source === 'ai' ? /参考 AI 建议/ : /依据自己判断/ })
      .click();
    if (source === 'ai') {
      await page.getByRole('button', { name: '发送消息', exact: true }).click();
      const back = page.getByRole('button', { name: /返回并确认最终预测/ });
      await expect(back).toBeEnabled({ timeout: 20000 });
      await back.click();
    }
    await page.getByRole('button', { name: '选择机器 B', exact: true }).click();
    await page.getByRole('button', { name: /锁定最终预测/ }).click();
    await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
    await completePostQuestionnaires(page);
    await expect(page.locator('#step-label')).toHaveText('本轮完成');
    await page.reload();
    await expect(page.locator('#step-label')).toHaveText('本轮完成');
    const data = await page.evaluate(async () => (await fetch('/api/export')).json());
    expect(data.completed).toBe(true);
    expect(data.events).toHaveLength(source === 'ai' ? 14 : 13);
    expect(new Set(data.events.map((event: { event_id: string }) => event.event_id)).size).toBe(
      data.events.length,
    );
    expect(data.feedback.advice_evaluation.advice_exposed).toBe(source === 'ai');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载本轮记录/ }).click();
    await (await download).saveAs(`artifacts/collection-tests/campus-${source}.json`);
    expect(errors).toEqual([]);
  });
}
