import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias from tsconfig.json. Without it, vitest
    // cannot resolve the imports Next.js handles natively.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // `resolve-features` reads validated client config at import time, so the
    // suite needs the same variables a real render would have.
    env: {
      NEXT_PUBLIC_API_BASE_URL: 'http://localhost:4000/api/v1',
      NEXT_PUBLIC_DEFAULT_TENANT: 'mauritius',
      NEXT_PUBLIC_FLAG_OVERRIDES: '',
    },
  },
});
