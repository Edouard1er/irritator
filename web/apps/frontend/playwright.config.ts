import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.IRRITATOR_PLAYWRIGHT_REPORT ?? '../../../build-web-test5/logs/playwright.json' }]],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: process.env.FRONTEND_URL ?? 'http://127.0.0.1:3000', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true },
  // Start Fastify and Next.js separately. The tests exercise these real running servers.
});
