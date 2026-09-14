import { defineConfig } from 'vitest/config';

/**
 * The integration suite: the real app, a real database, a real Redis.
 *
 * Separate from `vitest.config.ts` because these tests have prerequisites the
 * unit tests must never acquire — a build to boot and infrastructure to talk
 * to. They skip cleanly when nothing is listening, so this is safe to run
 * anywhere; it simply proves less when it skips.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/__tests__/integration/**/*.test.ts'],
    /*
     * One worker.
     *
     * Each file boots a whole Nest application with its own database pool and
     * Redis connections; running four at once exhausts Postgres connections on
     * a default `max_connections` long before it saves any wall-clock time.
     */
    fileParallelism: false,
    // Booting the app and walking a reset flow is slower than a unit test.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
