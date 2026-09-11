import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // The domain layer carries the business rules, so it carries the bar.
      thresholds: { 'src/modules/*/domain/**': { lines: 90, functions: 90 } },
    },
  },
});
