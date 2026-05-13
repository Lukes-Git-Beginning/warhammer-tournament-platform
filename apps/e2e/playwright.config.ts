import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];

// In CI: use pre-built artifacts (faster, stable).
// Backend: `start` runs `node dist/server.js` (built by the prior Build step).
// Frontend: `preview` serves the Vite production build (also built in Build step).
// Locally: dev servers with HMR for fast iteration.
const backendCmd = isCI
  ? 'pnpm --filter @tww3/backend start'
  : 'pnpm --filter @tww3/backend dev';
const frontendCmd = isCI
  ? 'pnpm --filter @tww3/frontend preview'
  : 'pnpm --filter @tww3/frontend dev';

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
      command: backendCmd,
      port: 3000,
      reuseExistingServer: !isCI,
      timeout: isCI ? 60_000 : 30_000,
      env: { NODE_ENV: 'test' },
    },
    {
      command: frontendCmd,
      port: 5173,
      reuseExistingServer: !isCI,
      timeout: isCI ? 60_000 : 30_000,
    },
  ],
});
