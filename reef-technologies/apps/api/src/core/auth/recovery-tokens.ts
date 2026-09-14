import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SINGLE-USE RECOVERY TOKENS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A password-reset link is a bearer credential that travels through a channel
 * the platform does not control and cannot take back. Three properties follow
 * from that, and each is enforced here rather than trusted to a caller:
 *
 *   STORED HASHED — only SHA-256 of the token is persisted, so a dump of the
 *     recovery store yields nothing usable. (SHA-256 and not Argon2: the token
 *     is 256 bits of CSPRNG output, so there is no dictionary to attack and
 *     nothing for a slow hash to buy. Passwords are a different problem, and
 *     get Argon2id.)
 *
 *   SINGLE USE — consumption reads and deletes in one Lua call, so two
 *     concurrent clicks cannot both succeed. Anything else is a race between
 *     the victim and whoever else read the mailbox.
 *
 *   SHORT LIVED — the TTL is Redis's, not a column someone forgets to check.
 *
 * Issuing also retires the account's outstanding tokens for that purpose, so
 * "send me another link" narrows the window instead of widening it.
 */

/**
 * Namespaced by purpose, so a verification token cannot be presented as a
 * password reset. They are indistinguishable strings; only the key they were
 * filed under separates them.
 */
export type RecoveryPurpose = 'password-reset' | 'email-verify';

export interface RecoverySubject {
  userId: string;
  tenantId: string;
  email: string;
  locale: string;
}

const tokenKey = (purpose: RecoveryPurpose, tokenHash: string) =>
  `auth:recovery:${purpose}:${tokenHash}`;

/** Lets a reset retire the account's other outstanding links for that purpose. */
const indexKey = (purpose: RecoveryPurpose, tenantId: string, userId: string) =>
  `auth:recovery-index:${purpose}:${tenantId}:${userId}`;

/**
 * Read-and-delete in one step.
 *
 * A GET followed by a DEL from Node leaves a window in which two requests both
 * read a live token and both proceed — which is exactly the case this is meant
 * to prevent, since the second reader may be the attacker.
 */
const CONSUME_SCRIPT = `
local data = redis.call('HGETALL', KEYS[1])
if #data == 0 then return {} end
redis.call('DEL', KEYS[1])
return data
`;

@Injectable()
export class RecoveryTokenService {
  private readonly logger = new Logger(RecoveryTokenService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Mints a token and returns it in the clear — the only moment it exists in
   * readable form. It goes straight into a link and is never logged, returned
   * over HTTP, or written to the database.
   */
  async issue(
    purpose: RecoveryPurpose,
    subject: RecoverySubject,
    ttlSeconds: number,
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = digest(token);
    const index = indexKey(purpose, subject.tenantId, subject.userId);

    // Retire whatever is outstanding first. Deliberately last-one-wins: if two
    // requests race, one link works and the other does not, which is the
    // behaviour a user expects from "send me a new link" anyway.
    const outstanding = await this.redis.smembers(index).catch(() => [] as string[]);

    const pipeline = this.redis.multi();
    for (const stale of outstanding) pipeline.del(tokenKey(purpose, stale));
    pipeline.del(index);
    pipeline.hset(tokenKey(purpose, hash), { ...subject, issuedAt: String(Date.now()) });
    pipeline.expire(tokenKey(purpose, hash), ttlSeconds);
    pipeline.sadd(index, hash);
    // The index is a convenience, not a source of truth; it must not outlive
    // the tokens it points at, or it accumulates forever.
    pipeline.expire(index, ttlSeconds);
    await pipeline.exec();

    return token;
  }

  /**
   * Redeems a token, or returns `null`.
   *
   * `null` covers every failure — unknown, expired, already used, malformed,
   * Redis unreachable — because the caller must say the same thing to the user
   * in all of them. Distinguishing "expired" from "never existed" tells an
   * attacker which addresses have pending resets.
   */
  async consume(purpose: RecoveryPurpose, token: string): Promise<RecoverySubject | null> {
    if (!token) return null;
    const hash = digest(token);

    let reply: unknown;
    try {
      reply = await this.redis.eval(CONSUME_SCRIPT, 1, tokenKey(purpose, hash));
    } catch (error) {
      // Fail closed. A recovery flow that cannot verify a token must refuse
      // it; the opposite choice would turn a Redis outage into free password
      // resets.
      this.logger.error(
        `recovery store unreachable while consuming a ${purpose} token`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }

    const record = fromFlatReply(reply);
    if (!record) return null;

    const { userId, tenantId, email, locale } = record;
    if (!userId || !tenantId || !email) return null;

    /*
     * Tidy the index now that the reply has named the owner — which the script
     * could not, since the index key is derived from data it was reading.
     *
     * Best effort on purpose: the entry points at a key that no longer exists,
     * so a stale one grants nothing. It is cleared by the next issue anyway,
     * and expires with its own TTL regardless.
     */
    await this.redis.srem(indexKey(purpose, tenantId, userId), hash).catch(() => 0);

    return { userId, tenantId, email, locale: locale ?? 'en' };
  }

  /** Retires every outstanding token of a purpose — called after a reset lands. */
  async invalidateAll(
    purpose: RecoveryPurpose,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    const index = indexKey(purpose, tenantId, userId);
    const outstanding = await this.redis.smembers(index).catch(() => [] as string[]);
    if (outstanding.length === 0) return;

    const pipeline = this.redis.multi();
    for (const hash of outstanding) pipeline.del(tokenKey(purpose, hash));
    pipeline.del(index);
    await pipeline.exec().catch((error: unknown) => {
      this.logger.error(
        `failed to retire ${outstanding.length} ${purpose} token(s) for ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    });
  }
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

/** HGETALL comes back as a flat [field, value, field, value] array. */
function fromFlatReply(reply: unknown): Record<string, string> | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;

  const record: Record<string, string> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) {
    record[String(reply[i])] = String(reply[i + 1]);
  }
  return record;
}
