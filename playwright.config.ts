// One-trial preview acceptance. Uses installed Edge; this is not a real-device study test.
import { defineConfig } from '@playwright/test';
const port = process.env.PLAYWRIGHT_PORT ?? '5173';
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: 'tests/e2e',
  // Server-backed collection specs boot their own backend; they run under
  // playwright.collect.config.ts, not against this config's Vite dev server.
  testIgnore: '**/collection/**',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    channel: 'msedge',
    baseURL,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
