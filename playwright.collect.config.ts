// Collection-pilot browser acceptance for collect.html.
// Specs start their own in-process collection server (system-assigned port,
// temporary SQLite file) and therefore need no Playwright webServer; they do
// require the client build in dist/ (run `npm run build` first).
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e/collection',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    headless: true,
    viewport: { width: 1280, height: 850 },
  },
});
