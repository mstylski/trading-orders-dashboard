import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'NestJS',
      command: 'node dist/api/main.js',
      url: 'http://localhost:3000/contract-types',
      env: { API_PORT: '3000' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      name: 'Angular SSR',
      command: 'node dist/trading-orders-dashboard/server/server.mjs',
      url: 'http://localhost:4000',
      env: { PORT: '4000' },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
