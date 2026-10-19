import { expect, type Page } from '@playwright/test';

export async function enterBlock(page: Page): Promise<void> {
  await page.getByRole('button', { name: /开始试玩|开始正式实验/ }).click();
  await expect(page.locator('.slot-cabinet')).toHaveCount(3);
}
export async function selfRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
  await page.getByRole('button', { name: /确认独立预测/ }).click();
  await page.getByRole('button', { name: /依据自己判断/ }).click();
  await page.getByRole('button', { name: '选择机器 C', exact: true }).click();
  await page.getByRole('button', { name: /锁定最终预测/ }).click();
  await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
  await expect(page.locator('#step-label')).toHaveText('本轮完成');
}
export async function nextRound(page: Page): Promise<void> {
  await page.getByRole('button', { name: '继续 →', exact: true }).click();
}
export async function rounds(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await selfRound(page);
    await nextRound(page);
  }
}
