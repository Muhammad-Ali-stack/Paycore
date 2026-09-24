import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the PRODUCTION build in mock mode (no backend needed):
 *   NEXT_PUBLIC_API_MOCKING=enabled npm run build   (the flag is inlined at build time)
 *   npm run test:e2e                                  (starts `next start` itself)
 */
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1, // one stateful in-memory mock backend per server process
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Asia/Karachi',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_API_MOCKING: 'enabled',
      MOCK_LATENCY_MS: '40',
      MOCK_FUNDING_DELAY_MS: '3000',
      NEXT_PUBLIC_AUTOLOCK_MINUTES: '30',
    },
  },
});
