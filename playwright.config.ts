import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4182',
    url: 'http://127.0.0.1:4182',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:4182',
    ...devices['iPhone 14'],
  },
  projects: [
    { name: 'mobile-chromium', use: { browserName: 'chromium' } },
  ],
});
