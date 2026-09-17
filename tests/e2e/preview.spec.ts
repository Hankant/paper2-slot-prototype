import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [1280, 390]) {
  test(`one-trial preview, ${width}px: choices, actual outcome and export`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/preview.html');
    await expect(page.locator('#stage-title')).toHaveText('选择你预测会中奖的机器');
    await expect(page.locator('#advice')).toBeHidden();
    await expect(page.locator('#confirm')).toBeDisabled();
    await page.locator('[data-value="A"]').click();
    await page.locator('#confirm').click();
    await expect(page.locator('#stage-title')).toHaveText('你希望参考哪个来源？');
    await page.locator('[data-value="ai"]').click();
    await page.locator('#confirm').click();
    await expect(page.locator('#advice')).toContainText('机器 B');
    await page.screenshot({
      path: `artifacts/qa/codex-repair/preview-advice-${width}.png`,
      fullPage: true,
    });
    await page.locator('[data-value="A"]').click();
    await page.locator('#confirm').click();
    await expect(page.locator('#result')).toContainText('预测错误');
    await expect(page.locator('#result')).toContainText('+0 模拟积分');
    await expect(page.locator('#feedback-status')).toContainText('演示完成');
    await expect(page.locator('#save-status')).toContainText('7 条模拟记录 · 未上传');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (!downloadPath) throw new Error('Download missing');
    const exported = JSON.parse(await readFile(downloadPath, 'utf8'));
    expect(exported.simulation).toBe(true);
    expect(exported.persistence_scope).toBe('memory');
    expect(exported.feedback.actual_winner_machine_id).toBe('C');
    expect(exported.feedback.points_awarded).toBe(0);
    expect(exported.events).toHaveLength(7);
    expect(exported.events[0].payload.machine_id).toBe('A');
    expect(exported.events[4].payload.machine_id).toBe('A');
    await page.screenshot({
      path: `artifacts/qa/codex-repair/preview-result-${width}.png`,
      fullPage: true,
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.locator('#restart').click();
    await expect(page.locator('#stage-title')).toHaveText('选择你预测会中奖的机器');
    await expect(page.locator('#save-status')).toHaveText('未上传 · 仅本页内存');
    await page.reload();
    await expect(page.locator('#advice')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
