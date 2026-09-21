import { expect, type Page } from '@playwright/test';

const ANSWERS: Record<string, string> = {
  COMP_TARGET: 'next_winner',
  COMP_INITIAL_LOCK: 'cannot_change',
  COMP_ADVICE_FALLIBLE: 'not_guaranteed',
  COMP_FINAL_CHOICE: 'free_choice',
  POST_MC_DISCLOSURE: 'no',
  POST_MC_SOURCE: 'ai',
};

export async function completeQuestionnaireBlock(page: Page, blockId: string): Promise<void> {
  const block = page.locator(`[data-block-id="${blockId}"]`);
  await expect(block).toBeVisible();
  for (const slider of await block.locator('input[type="range"]').all()) {
    await slider.evaluate((element) => {
      const input = element as HTMLInputElement;
      input.value = '60';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  for (const item of await block.locator('[data-item-id]').all()) {
    const id = await item.getAttribute('data-item-id');
    const radios = item.locator('input[type="radio"]');
    if ((await radios.count()) > 0) {
      const configured = id ? ANSWERS[id] : undefined;
      if (configured) await item.locator(`input[value="${configured}"]`).check();
      else await radios.nth(Math.floor((await radios.count()) / 2)).check();
    }
    const text = item.locator('textarea, input[type="text"]');
    if ((await text.count()) > 0) {
      const optional = (await item.locator('legend').textContent())?.includes('选答') ?? false;
      if (!optional) await text.fill('我认为研究关注不同判断来源如何影响最终选择。');
    }
  }
  await block.locator('button[type="submit"]').click();
  await expect(block).toHaveCount(0);
}

export async function completePreQuestionnaires(page: Page): Promise<void> {
  await completeQuestionnaireBlock(page, 'pre-prior-beliefs');
  await completeQuestionnaireBlock(page, 'pre-comprehension');
}

export async function completePostQuestionnaires(page: Page): Promise<void> {
  for (const id of [
    'post-performance-beliefs',
    'post-trust',
    'post-threshold-process',
    'post-experience',
  ])
    await completeQuestionnaireBlock(page, id);
}
