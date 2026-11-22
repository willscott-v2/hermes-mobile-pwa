import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**', 'dist-candidate/**', 'tests/e2e/**', 'scripts/qa/**'],
  },
});
