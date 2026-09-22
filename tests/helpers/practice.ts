import { expect, type Page } from '@playwright/test';

export async function completePractice(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: '先试玩三轮，熟悉预测与计分' })).toBeVisible();
  await expect(page.getByText('人类平均命中率')).toBeVisible();
  await expect(page.getByText('AI 助手命中率')).toBeVisible();
  for (const [index, machine] of ['A', 'A', 'B'].entries()) {
    await page.locator(`.practice-machine[data-machine="${machine}"]`).click();
    await page.getByRole('button', { name: '确认并开奖', exact: true }).click();
    if (index < 2) await page.getByRole('button', { name: '下一轮', exact: true }).click();
    else await page.getByRole('button', { name: '完成试玩', exact: true }).click();
  }
}
