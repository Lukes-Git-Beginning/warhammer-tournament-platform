import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: {
    timeout: 5000,
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @tww3/backend dev',
      port: 3000,
      reuseExistingServer: !process.env['CI'],
    },
    {
      command: 'pnpm --filter @tww3/frontend dev',
      port: 5173,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
