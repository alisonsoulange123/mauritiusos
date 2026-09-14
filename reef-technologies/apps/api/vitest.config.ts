import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    /*
     * Integration tests are excluded here and run by `pnpm test:integration`.
     *
     * They need two things this command deliberately does not: a built `dist/`
     * to boot, and a real Postgres and Redis. Keeping them out means
     * `pnpm verify` stays fast and runnable on a laptop with nothing up, which
     * is what makes it worth running before every commit.
     */
    exclude: ['src/__tests__/integration/**', '**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      // The domain layer carries the business rules, so it carries the bar.
      thresholds: { 'src/modules/*/domain/**': { lines: 90, functions: 90 } },
    },
  },
});
