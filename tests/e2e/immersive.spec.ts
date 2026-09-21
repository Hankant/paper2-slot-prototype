import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { completePostQuestionnaires, completePreQuestionnaires } from '../helpers/questionnaire.js';

async function completeEntry(page: Page, width?: number): Promise<void> {
  await expect(page.getByRole('heading', { name: '预测任务参与知情同意书' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  const accept = page.getByRole('button', { name: /同意并查看操作说明/ });
  await expect(accept).toBeDisabled();
  await expect(page.getByRole('checkbox').nth(0)).not.toBeChecked();
  if (width)
    await page.screenshot({ path: `artifacts/qa/atelier/entry-${width}.png`, fullPage: true });
  await page.getByRole('checkbox').nth(0).check();
  await expect(accept).toBeDisabled();
  await page.getByRole('checkbox').nth(1).check();
  await accept.click();
  await expect(page.getByRole('heading', { name: '一次预测，分三步完成。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  if (width)
    await page.screenshot({
      path: `artifacts/qa/atelier/instructions-${width}.png`,
      fullPage: true,
    });
  await page.getByRole('button', { name: /开始实验/ }).click();
  await completePreQuestionnaires(page);
}

for (const width of [1280, 390]) {
  test(`atelier ${width}: controlled flow, stopped stream, history and exported advice comparisons`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/preview-immersive.html');
    await completeEntry(page, width);
    await expect(page.getByRole('button', { name: '确认独立预测 →', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '拉杆开奖' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const boxes = await page.locator('.slot-cabinet').evaluateAll((els) =>
      els.map((el) => ({
        top: el.getBoundingClientRect().top,
        bottom: el.getBoundingClientRect().bottom,
      })),
    );
    expect(new Set(boxes.map((b) => b.top)).size).toBe(1);
    expect(await page.locator('body').evaluate((e) => e.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/qa/atelier/slots-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
    await page.getByRole('button', { name: '确认独立预测 →', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择机器 B', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: /^参考 AI 建议/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const finish = page.getByRole('button', { name: '返回并确认最终预测 ↗', exact: true });
    await expect(finish).toBeDisabled();
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(page.locator('.answer-text').first()).toContainText('我的建议');
    await expect(finish).toBeDisabled();
    if (width === 390) {
      await page.getByRole('button', { name: '收起对话', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
      await page.getByRole('button', { name: /继续与助手对话/ }).click();
    } else {
      await page.getByRole('button', { name: '停止回答', exact: true }).click();
    }
    await expect(page.getByRole('button', { name: '继续读取同一回答' })).toBeVisible();
    const prefix = await page.locator('.answer-text').first().textContent();
    await expect(finish).toBeDisabled();
    await page.screenshot({
      path: `artifacts/qa/atelier/chat-stopped-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: '继续读取同一回答' }).click();
    await expect(finish).toBeEnabled({ timeout: 15000 });
    expect(
      (await page.locator('.answer-text').first().textContent())?.startsWith(prefix ?? ''),
    ).toBe(true);
    await page.getByRole('button', { name: '如何使用建议', exact: true }).click();
    await page.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(finish).toBeEnabled({ timeout: 15000 });
    await expect(page.locator('.user-message')).toHaveCount(2);
    await expect(page.locator('.answer-text')).toHaveCount(2);
    await page.screenshot({ path: `artifacts/qa/atelier/chat-${width}.png`, fullPage: true });
    await finish.click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '锁定最终预测 →', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '选择机器 B', exact: true }).click();
    await page.getByRole('button', { name: '锁定最终预测 →', exact: true }).click();
    await expect(page.getByRole('button', { name: '选择机器 A', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
    await expect(page.locator('.spinning')).toHaveCount(3);
    await expect(page.locator('.result-card')).toBeHidden();
    await expect(page.locator('.result-card')).toContainText('机器 C 中奖');
    await completePostQuestionnaires(page);
    await expect(page.locator('.spinning')).toHaveCount(0);
    await expect(page.locator('.result-score')).toContainText('+0');
    await expect(page.locator('.winner')).toHaveAttribute('data-machine', 'C');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载本轮记录 ↓', exact: true }).click();
    const file = await (await download).path();
    if (!file) throw new Error('download missing');
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(data.events).toHaveLength(14);
    expect(data.events[0]).toMatchObject({
      event_type: 'consent_recorded',
      phase: 'consent',
      sequence_no: 0,
      payload: { version: data.entry.consent_version },
      client_timestamp: data.entry.accepted_at,
    });
    expect(data.events[0]).not.toHaveProperty('trial_id');
    expect(data.entry_material.consentVersion).toBe(data.entry.consent_version);
    expect(Date.parse(data.entry.accepted_at)).toBeLessThanOrEqual(
      Date.parse(data.entry.started_at),
    );
    expect(data.feedback.advice_actual_hit).toBe(false);
    expect(data.feedback.advice_evaluation).toMatchObject({
      advice_exposed: true,
      final_matches_advice: true,
      switched_to_advice: true,
    });
    const requests = data.presentation_audit.filter(
      (e: { type: string }) => e.type === 'chat_requested',
    );
    expect(requests[0].data.request_id).toBe(requests[1].data.request_id);
    expect(data.persistence_scope).toBe('memory');
    expect(errors).toEqual([]);
  });
}

test('atelier 360: self branch, no advice, actual winner scoring', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/preview-immersive.html');
  await completeEntry(page);
  await page.getByRole('button', { name: '选择机器 A', exact: true }).click();
  await page.getByRole('button', { name: '确认独立预测 →', exact: true }).click();
  await page.getByRole('button', { name: /依据自己判断/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '选择机器 C', exact: true }).click();
  await page.getByRole('button', { name: '锁定最终预测 →', exact: true }).click();
  await page.getByRole('button', { name: '拉杆开奖', exact: true }).click();
  await completePostQuestionnaires(page);
  await expect(page.locator('.result-score')).toContainText('+10');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载本轮记录 ↓', exact: true }).click();
  const file = await (await download).path();
  if (!file) throw new Error('download missing');
  const data = JSON.parse(await readFile(file, 'utf8'));
  expect(data.feedback.advice_actual_hit).toBeNull();
  expect(data.feedback.advice_evaluation).toMatchObject({
    advice_exposed: false,
    final_matches_advice: null,
  });
  expect(data.events).toHaveLength(13);
  await expect(page.locator('.experience-error')).toBeEmpty();
});

test('entry: decline, reconsider, return from instructions and refresh never bypass consent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/preview-immersive.html');
  await page.getByRole('button', { name: '不同意并退出', exact: true }).click();
  await expect(page.getByRole('heading', { name: '已退出本次体验。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  await page.getByRole('button', { name: '返回参与说明', exact: true }).click();
  await page.getByRole('checkbox').nth(0).check();
  await page.getByRole('checkbox').nth(1).check();
  await page.getByRole('button', { name: /同意并查看操作说明/ }).click();
  await page.getByRole('button', { name: '返回修改参与决定', exact: true }).click();
  await expect(page.getByRole('checkbox').nth(0)).not.toBeChecked();
  await expect(page.getByRole('button', { name: /同意并查看操作说明/ })).toBeDisabled();
  await completeEntry(page);
  await expect(page.getByRole('button', { name: '选择机器 A' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '选择机器 A' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /同意并查看操作说明/ })).toBeDisabled();
  expect(await page.locator('body').evaluate((e) => e.scrollWidth <= innerWidth)).toBe(true);
});
