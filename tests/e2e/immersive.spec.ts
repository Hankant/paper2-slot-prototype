import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { completePreQuestionnaires, completePostQuestionnaires } from '../helpers/questionnaire.js';
import { enterBlock, rounds, nextRound, selfRound, setConfidence } from '../helpers/multi-round.js';

async function entry(page: Page) {
  for (const c of await page.getByRole('checkbox').all()) await c.check();
  await page.getByRole('button', { name: /同意并查看操作说明/ }).click();
  await page.getByRole('button', { name: /开始实验/ }).click();
}
for (const width of [1280, 390])
  test(`shared slot UI and complete 11-round flow ${width}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/preview-immersive.html');
    await expect(page.getByRole('button', { name: /同意并查看操作说明/ })).toBeDisabled();
    await entry(page);
    await page.screenshot({ path: `artifacts/qa/gate-practice-${width}.png`, fullPage: true });
    await enterBlock(page);
    await expect(page.locator('.round-counter').first()).toContainText('/ 03');
    await expect(page.getByText('人类平均命中率')).toBeVisible();
    await expect(page.getByText('AI 助手命中率')).toBeVisible();
    expect(await page.locator('body').evaluate((e) => e.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/qa/multi-practice-${width}.png`, fullPage: true });
    // Exercise stopped/retried streaming within the same shared practice trial.
    await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
    await setConfidence(page);
    await page.getByRole('button', { name: /确认独立预测/ }).click();
    await page.getByRole('button', { name: /参考 AI 建议/ }).click();
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.answer-text').first()).toContainText('我的建议');
    await page.getByRole('button', { name: '停止回答', exact: true }).click();
    await page.getByRole('button', { name: '继续读取同一回答', exact: true }).click();
    const back = page.getByRole('button', { name: /返回并确认最终预测/ });
    await expect(back).toBeEnabled({ timeout: 20000 });
    await back.click();
    await page.getByRole('button', { name: '选择机器 C', exact: true }).click();
    await page.getByRole('button', { name: /锁定最终预测/ }).click();
    await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
    await expect(page.locator('#step-label')).toHaveText('本轮完成');
    await nextRound(page);
    await rounds(page, 2);
    await completePreQuestionnaires(page);
    await page.screenshot({ path: `artifacts/qa/gate-formal-${width}.png`, fullPage: true });
    await enterBlock(page);
    await expect(page.locator('.round-counter').first()).toContainText('/ 08');
    await page.screenshot({ path: `artifacts/qa/multi-formal-${width}.png`, fullPage: true });
    let total = 0;
    let capturedReward = false;
    for (let i = 0; i < 8; i++) {
      await expect(page.locator('.score-number')).toHaveText(String(total));
      await selfRound(page);
      const reward = page.locator('.reward-feedback');
      await expect(reward).toBeVisible();
      const awarded = Number((await reward.innerText()).match(/本轮 \+(\d+)/)?.[1]);
      expect([0, 10]).toContain(awarded);
      total += awarded;
      await expect(page.locator('.score-number')).toHaveText(String(total));
      if (awarded > 0 && !capturedReward) {
        await reward.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `artifacts/qa/reward-${width}.png` });
        capturedReward = true;
      }
      await nextRound(page);
    }
    await completePostQuestionnaires(page);
    await expect(page.getByRole('heading', { name: '感谢完成本次任务' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /下载全部记录/ }).click();
    const file = await (await download).path();
    const data = JSON.parse(await readFile(file!, 'utf8'));
    expect(data.feedbacks).toHaveLength(11);
    expect(
      data.events.filter(
        (e: { event_type: string }) => e.event_type === 'questionnaire_block_submitted',
      ),
    ).toHaveLength(6);
    expect(
      data.events.filter((e: { event_type: string }) => e.event_type === 'prediction_submitted'),
    ).toHaveLength(11);
    expect(data.events.at(-1).event_type).toBe('session_completion_requested');
    expect(data.feedbacks[0].advice_evaluation.advice_exposed).toBe(true);
    expect(
      data.feedbacks
        .slice(1)
        .every((f: { advice_actual_hit: null }) => f.advice_actual_hit === null),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
test('decline and refresh do not bypass consent', async ({ page }) => {
  await page.goto('/preview-immersive.html');
  await page.getByRole('button', { name: '不同意并退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已退出本次体验。' })).toBeVisible();
  await page.getByRole('button', { name: '返回参与说明', exact: true }).click();
  await entry(page);
  await enterBlock(page);
  await page.reload();
  await expect(page.getByRole('button', { name: /同意并查看操作说明/ })).toBeDisabled();
});
