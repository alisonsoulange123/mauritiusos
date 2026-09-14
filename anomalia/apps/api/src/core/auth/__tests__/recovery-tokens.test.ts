import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { RecoveryTokenService, type RecoverySubject } from '../recovery-tokens.js';

/**
 * Against a real Redis, for the same reason the session registry is: the
 * property under test is atomicity. Single use is enforced by a Lua
 * read-and-delete, and a mock that re-implements it would prove nothing about
 * what happens when two requests arrive together — which, for a password reset
 * link, is the case that decides whether the second reader of a mailbox gets
 * in.
 *
 * Skips rather than fails when nothing is listening, so `pnpm verify` still
 * works on a laptop with no infrastructure up. CI provides the service.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

let reachable = false;

const itWithRedis = (name: string, body: () => Promise<void>) =>
  it(name, async (ctx) => {
    if (!reachable) ctx.skip();
    await body();
  });

const TENANT = 'tenant-recovery-test';

describe('RecoveryTokenService', () => {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  const service = new RecoveryTokenService(redis);

  let subject: RecoverySubject;

  beforeAll(async () => {
    reachable = await redis
      .connect()
      .then(() => true)
      .catch(() => false);
  });

  // A distinct user per test: issuing retires the account's outstanding
  // tokens, so a shared id would let one test invalidate another's.
  beforeEach(() => {
    subject = {
      userId: `user-${Math.random().toString(36).slice(2)}`,
      tenantId: TENANT,
      email: 'jean@example.com',
      locale: 'fr',
    };
  });

  afterAll(async () => {
    if (!reachable) return;

    const keys = [
      ...(await redis.keys('auth:recovery:*')),
      ...(await redis.keys(`auth:recovery-index:*:${TENANT}:*`)),
    ];
    const mine: string[] = [];
    for (const key of keys) {
      // Token keys are named by a hash, so the tenant inside the record is the
      // only thing marking one as this suite's.
      const tenant = await redis.hget(key, 'tenantId').catch(() => null);
      if (tenant === TENANT || key.includes(TENANT)) mine.push(key);
    }
    if (mine.length) await redis.del(...mine);
    await redis.quit();
  });

  itWithRedis('round-trips the subject to whoever holds the token', async () => {
    const token = await service.issue('password-reset', subject, 60);

    expect(await service.consume('password-reset', token)).toEqual(subject);
  });

  itWithRedis('never stores the token itself', async () => {
    const token = await service.issue('password-reset', subject, 60);

    // The key is the hash; the token must not appear anywhere in Redis, so a
    // dump of the recovery store yields nothing usable.
    expect(await redis.exists(`auth:recovery:password-reset:${token}`)).toBe(0);
    expect(
      await redis.exists(`auth:recovery:password-reset:${sha256(token)}`),
    ).toBe(1);
  });

  itWithRedis('accepts a token exactly once', async () => {
    const token = await service.issue('password-reset', subject, 60);

    expect(await service.consume('password-reset', token)).not.toBeNull();
    // The second attempt is either a user double-clicking or someone else
    // reading the same mailbox. Both get nothing.
    expect(await service.consume('password-reset', token)).toBeNull();
  });

  itWithRedis('lets only one of two simultaneous redemptions win', async () => {
    const token = await service.issue('password-reset', subject, 60);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => service.consume('password-reset', token)),
    );

    // The whole reason the read and the delete are one Lua call.
    expect(outcomes.filter((outcome) => outcome !== null)).toHaveLength(1);
  });

  itWithRedis('will not let a verification token act as a password reset', async () => {
    const token = await service.issue('email-verify', subject, 60);

    // Indistinguishable strings; only the namespace separates them. Without
    // it, the weaker flow would mint credentials for the stronger one.
    expect(await service.consume('password-reset', token)).toBeNull();
    expect(await service.consume('email-verify', token)).not.toBeNull();
  });

  itWithRedis('retires the previous link when a new one is issued', async () => {
    const first = await service.issue('password-reset', subject, 60);
    const second = await service.issue('password-reset', subject, 60);

    // "Send me another link" must narrow the window, not widen it: two live
    // reset links means two chances for whoever else reads the mailbox.
    expect(await service.consume('password-reset', first)).toBeNull();
    expect(await service.consume('password-reset', second)).not.toBeNull();
  });

  itWithRedis('keeps purposes independent when retiring', async () => {
    const verify = await service.issue('email-verify', subject, 60);
    await service.issue('password-reset', subject, 60);

    // Asking for a reset must not invalidate a confirmation link the user is
    // about to click.
    expect(await service.consume('email-verify', verify)).not.toBeNull();
  });

  itWithRedis('expires on its own', async () => {
    const token = await service.issue('password-reset', subject, 1);

    // The TTL is Redis's, not a column someone has to remember to check.
    expect(await redis.ttl(`auth:recovery:password-reset:${sha256(token)}`)).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(await service.consume('password-reset', token)).toBeNull();
  });

  itWithRedis('drops outstanding links on demand', async () => {
    const token = await service.issue('password-reset', subject, 60);

    await service.invalidateAll('password-reset', subject.tenantId, subject.userId);

    expect(await service.consume('password-reset', token)).toBeNull();
  });

  itWithRedis('rejects nonsense without asking Redis about it', async () => {
    expect(await service.consume('password-reset', '')).toBeNull();
    expect(await service.consume('password-reset', 'not-a-real-token')).toBeNull();
  });
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
