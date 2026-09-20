import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/collection-e2e',
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:5218',
    headless: true,
    viewport: { width: 1280, height: 850 },
  },
  webServer: {
    command: 'node tools/serve-collection-test.ts',
    url: 'http://127.0.0.1:5218/api/health',
    reuseExistingServer: false,
    timeout: 20000,
  },
});
