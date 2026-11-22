import { defineConfig, devices } from '@playwright/test';

// Candidate-bundle QA config: targets the preview server that serves dist-candidate on 4180
// (`npm run preview:candidate`). Does not start or build anything itself.
export default defineConfig({
  testDir: '.',
  testMatch: /candidate-.*\.spec\.ts/,
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4180', ...devices['iPhone 14'], browserName: 'chromium' },
  reporter: 'line',
});
