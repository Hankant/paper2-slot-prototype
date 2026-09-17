const { chromium } = require('@playwright/test');
const { mkdirSync, writeFileSync } = require('node:fs');
const { strict: assert } = require('node:assert');

(async () => {
  const outputDirectory = process.env.REVIEW_OUTPUT_DIR || 'artifacts/qa/g0-review';
  mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 390, height: 844 },
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(process.env.REVIEW_BASE_URL || 'http://127.0.0.1:5197/');
      await page.locator('[data-bootstrap-report]').waitFor();
      const report = JSON.parse(await page.locator('[data-bootstrap-report]').innerText());
      assert.equal(response.status(), 200);
      assert.equal(report.adapter_wired, false);
      assert.equal(report.banner, 'SIMULATION');
      assert.equal(await page.locator('[data-phase-list] li').count(), 9);
      await page.reload();
      await page.locator('[data-bootstrap-report]').waitFor();
      assert.deepEqual(errors, []);
      const layout = await page.evaluate(() => ({
        width: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        statusWidth: document.querySelector('[data-bootstrap-report]').clientWidth,
        statusContentWidth: document.querySelector('[data-bootstrap-report]').scrollWidth,
      }));
      assert.ok(layout.documentWidth <= layout.width, 'Page must not overflow horizontally');
      const screenshot = `${outputDirectory}/g0-${viewport.width}.png`;
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({ viewport, errors, report, layout, screenshot });
      await page.close();
    }
    const evidence = { browser: browser.version(), results };
    writeFileSync(`${outputDirectory}/browser-results.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
