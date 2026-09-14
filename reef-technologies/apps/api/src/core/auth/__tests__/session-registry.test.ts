import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Redis from 'ioredis';
import { SessionRegistry } from '../session-registry.js';
import type { ConfigService } from '../../config/config.service.js';

/**
 * Exercised against a real Redis, because the part worth testing is the Lua
 * compare-and-swap: a mock that re-implements the script would only prove the
 * mock agrees with itself, and the whole point of pushing the decision into
 * Redis is atomicity under concurrency.
 *
 * CI provides a redis service, so these run there. Locally they skip when
 * nothing is listening rather than failing a `pnpm verify` on a laptop with no
 * infrastructure up.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

let reachable = false;

/*
 * Probed in `beforeAll` rather than at module scope: this package compiles to
 * CommonJS, where a top-level await is a type error even though the test
 * runner would happily execute it.
 */
const itWithRedis = (name: string, body: () => Promise<void>) =>
  // Context type left to inference: `skip()` lives on the runner's task
  // context, which is not the type vitest exports under that name.
  it(name, async (ctx) => {
    if (!reachable) ctx.skip();
    await body();
  });

const configFake = (graceSeconds: number): ConfigService =>
  ({
    core: {
      JWT_REFRESH_TTL_SECONDS: 3600,
      JWT_ACCESS_TTL_SECONDS: 900,
      AUTH_REFRESH_GRACE_SECONDS: graceSeconds,
    },
  }) as unknown as ConfigService;

describe('SessionRegistry', () => {
  const redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true, enableOfflineQueue: false });
  const tenantId = 'tenant-test';

  beforeAll(async () => {
    reachable = await redis
      .connect()
      .then(() => true)
      .catch(() => false);
  });

  // A distinct user per test, so a revoke-all in one cannot affect another.
  let userId: string;
  beforeEach(() => {
    userId = `user-${Math.random().toString(36).slice(2)}`;
  });

  afterAll(async () => {
    if (!reachable) return;

    /*
     * Family keys are named by a random id, so there is no pattern to match
     * them on — the tenant stamped inside each record is the only thing that
     * marks one as this suite's. Matching on the key name left every family
     * behind in a shared Redis.
     */
    const families = await redis.keys('auth:family:*');
    const mine: string[] = [];
    for (const key of families) {
      if ((await redis.hget(key, 'tenantId')) === tenantId) mine.push(key);
    }

    const indexes = await redis.keys(`auth:user:${tenantId}:*`);
    const doomed = [...mine, ...indexes];
    if (doomed.length) await redis.del(...doomed);

    await redis.quit();
  });

  itWithRedis('rotates, issuing a new token id each time', async () => {
    const registry = new SessionRegistry(redis, configFake(10));
    const opened = await registry.open(userId, tenantId);

    const first = await registry.rotate(opened.familyId, opened.tokenId);
    expect(first.status).toBe('rotated');

    if (first.status !== 'rotated') return;
    expect(first.handle.tokenId).not.toBe(opened.tokenId);
    // The lineage is stable across rotations; only the token id moves.
    expect(first.handle.familyId).toBe(opened.familyId);

    const second = await registry.rotate(first.handle.familyId, first.handle.tokenId);
    expect(second.status).toBe('rotated');
  });

  itWithRedis('detects reuse of a retired token', async () => {
    // No grace: the previous token is invalid the instant it is replaced.
    const registry = new SessionRegistry(redis, configFake(0));
    const opened = await registry.open(userId, tenantId);

    await registry.rotate(opened.familyId, opened.tokenId);

    // The same token again — what an attacker replaying a stolen copy does.
    const replay = await registry.rotate(opened.familyId, opened.tokenId);
    expect(replay.status).toBe('reuse-detected');
  });

  itWithRedis('tolerates MANY concurrent refreshes of the same token', async () => {
    /*
     * The false positive that matters, and the one a two-request test misses.
     *
     * A browser firing parallel requests with one expired access cookie asks
     * to refresh with the SAME token several times over. An earlier version
     * compared the presented token only against the immediately-previous one,
     * so the first two requests advanced the chain and every later arrival —
     * holding a token now two steps back — was reported as an attack. Five
     * parallel requests signed the user out of every device they owned.
     */
    const registry = new SessionRegistry(redis, configFake(10));
    const opened = await registry.open(userId, tenantId);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => registry.rotate(opened.familyId, opened.tokenId)),
    );

    expect(outcomes.every((outcome) => outcome.status === 'rotated' || outcome.status === 'raced')).toBe(
      true,
    );
    // Exactly one may rotate; the rest are handed what the winner installed.
    expect(outcomes.filter((outcome) => outcome.status === 'rotated')).toHaveLength(1);

    // And they all converge on the same token, so whichever response the
    // browser stores last is the valid one.
    const tokens = new Set(
      outcomes.flatMap((outcome) => ('handle' in outcome ? [outcome.handle.tokenId] : [])),
    );
    expect(tokens.size).toBe(1);

    // The session is intact: the converged token still refreshes.
    const [only] = [...tokens];
    expect((await registry.rotate(opened.familyId, only!)).status).toBe('rotated');
  });

  itWithRedis('detects reuse once the grace window has expired', async () => {
    /*
     * The production path, and the one the other reuse test does NOT cover:
     * with a grace of 0 no marker is ever written, so that case exercises a
     * missing key rather than an expired one. Here the marker is really
     * written and really expires, which is what happens to every live session.
     */
    const registry = new SessionRegistry(redis, configFake(1));
    const opened = await registry.open(userId, tenantId);

    await registry.rotate(opened.familyId, opened.tokenId);

    // Inside the window the retired token is still treated as a racing sibling.
    expect((await registry.rotate(opened.familyId, opened.tokenId)).status).toBe('raced');

    await new Promise((resolve) => setTimeout(resolve, 1_300));

    // Outside it, the same token is a replay.
    expect((await registry.rotate(opened.familyId, opened.tokenId)).status).toBe('reuse-detected');
  });

  itWithRedis('revokes every session on the account when reuse is detected', async () => {
    const registry = new SessionRegistry(redis, configFake(0));

    // Two sign-ins: two devices, two independent lineages.
    const laptop = await registry.open(userId, tenantId);
    const phone = await registry.open(userId, tenantId);

    await registry.rotate(laptop.familyId, laptop.tokenId);
    const replay = await registry.rotate(laptop.familyId, laptop.tokenId);
    expect(replay.status).toBe('reuse-detected');

    const revoked = await registry.revokeAllForUser(tenantId, userId);
    expect(revoked).toBe(2);

    // The untouched device is signed out too — deliberately. A stolen token
    // gives no basis for trusting the account's other sessions.
    expect(await registry.isRevoked(laptop.familyId)).toBe(true);
    expect(await registry.isRevoked(phone.familyId)).toBe(true);
    expect((await registry.rotate(phone.familyId, phone.tokenId)).status).toBe('unknown');
  });

  itWithRedis('ends one lineage on sign-out without touching the others', async () => {
    const registry = new SessionRegistry(redis, configFake(10));
    const laptop = await registry.open(userId, tenantId);
    const phone = await registry.open(userId, tenantId);

    await registry.revokeFamily(laptop.familyId);

    expect(await registry.isRevoked(laptop.familyId)).toBe(true);
    expect((await registry.rotate(laptop.familyId, laptop.tokenId)).status).toBe('unknown');

    // Signing out of one device must not sign you out of the other.
    expect(await registry.isRevoked(phone.familyId)).toBe(false);
    expect((await registry.rotate(phone.familyId, phone.tokenId)).status).toBe('rotated');
  });

  itWithRedis('reports an unknown family rather than inventing a session', async () => {
    const registry = new SessionRegistry(redis, configFake(10));
    const outcome = await registry.rotate('no-such-family-test', 'no-such-token');
    expect(outcome.status).toBe('unknown');
  });
});
