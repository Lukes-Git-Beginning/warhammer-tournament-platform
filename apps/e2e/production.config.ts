import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/production-smoke.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 5000 },
  reporter: [['line']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://rizzotto.gg',
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
