import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { infrastructureAvailable, startHarness, type Harness } from './harness.js';

/**
 * The rate limiter, facing the real guard.
 *
 * Its own file because it boots with the limiter enabled, which every other
 * suite deliberately switches off — and because it guards a bug that made the
 * whole API unusable while looking completely healthy.
 */
let harness: Harness | null = null;

beforeAll(async () => {
  if (await infrastructureAvailable()) harness = await startHarness({ throttle: true });
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

const withApi = (name: string, body: (api: Harness) => Promise<void>) =>
  it(name, async (ctx) => {
    if (!harness) ctx.skip();
    await body(harness as Harness);
  });

/** Fires `count` requests in sequence and returns the statuses. */
async function burst(api: Harness, count: number, path: string, init: RequestInit = {}) {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await api.request(path, init)).status);
  }
  return statuses;
}

describe('credential endpoints', () => {
  withApi('stop a password-guessing burst at ten a minute', async (api) => {
    const statuses = await burst(api, 14, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', password: 'guess' }),
    });

    expect(statuses.filter((status) => status === 401)).toHaveLength(10);
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThan(0);
  });
});

describe('ordinary endpoints', () => {
  withApi('are not throttled by the credential bucket', async (api) => {
    /*
     * ════════════════════════════════════════════════════════════════════
     *  The regression this file exists for.
     * ════════════════════════════════════════════════════════════════════
     *
     * `ThrottlerModule.forRoot` enforces EVERY configured throttler on EVERY
     * route; the names only select which one a `@Throttle()` decorator
     * overrides. A second `auth` bucket at 10/min was therefore not a tighter
     * limit for credential endpoints — it was a 10-per-minute ceiling on the
     * entire API, which the credential routes then redundantly re-declared.
     *
     * Frontend caching kept it hidden until a Back Office page tried to walk
     * a directory. Fifteen reads is well under the real 120, and was refused
     * at eleven before the fix.
     */
    const statuses = await burst(api, 15, '/_platform/health');

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  withApi('keep their own generous ceiling', async (api) => {
    // The platform controller widens its bucket deliberately: capability and
    // topology reads happen on every page render.
    const statuses = await burst(api, 20, '/_platform/capabilities');

    expect(statuses.filter((status) => status === 429)).toHaveLength(0);
  });
});
