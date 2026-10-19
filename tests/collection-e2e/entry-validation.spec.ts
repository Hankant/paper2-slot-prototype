import { test, expect } from '@playwright/test';

test('invalid entry code stays on access page; valid code advances without opening a session', async ({
  page,
}) => {
  await page.goto('/collect.html');
  const code = page.getByLabel('参与码', { exact: true });
  const next = page.getByRole('button', { name: /继续阅读知情同意/ });
  await code.fill('INVALID-CODE');
  await next.click();
  await expect(page.getByRole('alert')).toContainText('参与码无效');
  await expect(code).toHaveValue('INVALID-CODE');
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await page.screenshot({ path: 'artifacts/qa/entry-validation-invalid.png', fullPage: true });
  await expect(page.locator('#consent-title')).toHaveCount(0);
  expect((await page.request.get('/api/session')).status()).toBe(401);
  await code.fill('PAPER2-TEST');
  await expect(page.getByRole('alert')).toBeEmpty();
  await next.click();
  await expect(page.locator('#consent-title')).toBeVisible();
  expect((await page.request.get('/api/session')).status()).toBe(401);
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'collect_session')).toBe(
    false,
  );
  await page.screenshot({ path: 'artifacts/qa/entry-validation-valid.png', fullPage: true });
});

test('validation connection failure stays on access page and can retry', async ({ page }) => {
  await page.goto('/collect.html');
  await page.route('**/api/entry/validate', (route) => route.abort('failed'));
  await page.getByLabel('参与码', { exact: true }).fill('PAPER2-TEST');
  await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
  await expect(page.getByRole('alert')).toContainText('网络');
  await expect(page.locator('#consent-title')).toHaveCount(0);
  await page.unroute('**/api/entry/validate');
  await page.getByRole('button', { name: /继续阅读知情同意/ }).click();
  await expect(page.locator('#consent-title')).toBeVisible();
});
