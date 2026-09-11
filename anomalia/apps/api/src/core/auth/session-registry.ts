import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { ConfigService } from '../config/config.service.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  REFRESH TOKEN ROTATION WITH REUSE DETECTION.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A refresh token is a 30-day bearer credential. Rotation alone shortens how
 * long a stolen one stays useful; it does not tell you that it WAS stolen.
 * Reuse detection does, and the signal is free:
 *
 *   Each refresh invalidates the token it was presented with. So if a token
 *   that has already been rotated away is presented again, two parties hold
 *   the same credential. One of them is not the user.
 *
 * There is no way to tell which, so the only safe response is to end every
 * session the account has — the attacker's and the victim's alike. The victim
 * signs in again; the attacker cannot.
 *
 * Tokens are grouped into FAMILIES. A family begins at sign-in and survives
 * rotation, so one stolen token revokes the lineage it belongs to rather than
 * one token in isolation.
 */

export interface SessionHandle {
  /** Stable across rotations; identifies the lineage. */
  familyId: string;
  /** Unique per rotation; this is what gets invalidated. */
  tokenId: string;
}

export type RotationOutcome =
  | { status: 'rotated'; handle: SessionHandle }
  /**
   * A concurrent request from the same client presented a token that was
   * retired moments ago. It gets the CURRENT token back rather than a new one,
   * so the chain advances once per genuine refresh no matter how many requests
   * raced for it.
   */
  | { status: 'raced'; handle: SessionHandle }
  /** Family gone: expired, signed out, or already revoked. */
  | { status: 'unknown' }
  /** A retired token came back. Treated as compromise. */
  | { status: 'reuse-detected' }
  /** Redis unreachable. The caller must fail closed — see below. */
  | { status: 'unavailable' };

const familyKey = (familyId: string) => `auth:family:${familyId}`;
const revokedKey = (familyId: string) => `auth:revoked:${familyId}`;
const userKey = (tenantId: string, userId: string) => `auth:user:${tenantId}:${userId}`;
/**
 * Marks one specific token as recently retired.
 *
 * Keyed by the token itself rather than by position in the chain. An earlier
 * version compared the presented token against the single previous one, which
 * broke the moment more than two requests raced: the first two advanced the
 * chain, and the third arrived holding a token two steps back and was
 * reported as an attack. A page load firing five parallel requests would have
 * signed the user out of every device.
 */
const graceKey = (familyId: string, tokenId: string) => `auth:grace:${familyId}:${tokenId}`;

/**
 * Compare-and-swap, server side, so two concurrent refreshes cannot both
 * believe they won. Doing this as GET-then-SET in Node would make a race
 * indistinguishable from an attack, and the penalty for that mistake is
 * signing a legitimate user out.
 *
 * The grace window is the other half of that problem. A browser can fire
 * several requests at once with the same expired access cookie, and each one
 * asks to refresh with the SAME refresh token. Without leeway the second
 * arrival looks exactly like reuse, and an ordinary page load would trigger a
 * security logout.
 *
 * So retiring a token leaves a marker against THAT token (see `graceKey`),
 * and any request presenting it while the marker lives is served the current
 * token instead of being refused. Not "the previous token stays valid": every
 * recently retired token does, however many requests raced, and none of them
 * advances the chain a second time.
 *
 * A grace of 0 writes no marker at all, so a retired token is a replay
 * immediately — the window is absent rather than merely narrow.
 */
const ROTATE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'jti')
if not current then return {'unknown'} end

local presented, nextJti, graceSeconds, ttl = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4]

if presented == current then
  -- Retire the presented token, leaving a short-lived marker so requests that
  -- raced this one are recognised rather than mistaken for a replay.
  if graceSeconds > 0 then
    redis.call('SET', KEYS[2], '1', 'EX', graceSeconds)
  end
  redis.call('HSET', KEYS[1], 'jti', nextJti)
  redis.call('HINCRBY', KEYS[1], 'rotations', 1)
  redis.call('EXPIRE', KEYS[1], ttl)
  return {'rotated'}
end

-- Retired, but only just. A racing sibling, not a replay: hand back whatever
-- is current instead of rotating again, so N concurrent requests all converge
-- on one token and the chain moves exactly once.
if redis.call('EXISTS', KEYS[2]) == 1 then
  return {'raced', current}
end

return {'reuse'}
`;

@Injectable()
export class SessionRegistry {
  private readonly logger = new Logger(SessionRegistry.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private get refreshTtl(): number {
    return this.config.core.JWT_REFRESH_TTL_SECONDS;
  }

  /** Starts a lineage. Called once per sign-in. */
  async open(userId: string, tenantId: string): Promise<SessionHandle> {
    const handle: SessionHandle = { familyId: randomUUID(), tokenId: randomUUID() };

    await this.redis
      .multi()
      .hset(familyKey(handle.familyId), {
        userId,
        tenantId,
        jti: handle.tokenId,
        rotations: '0',
        openedAt: String(Date.now()),
      })
      .expire(familyKey(handle.familyId), this.refreshTtl)
      // The reverse index. Reuse detection revokes every session the account
      // holds, which needs a way to enumerate them.
      .sadd(userKey(tenantId, userId), handle.familyId)
      .expire(userKey(tenantId, userId), this.refreshTtl)
      .exec();

    return handle;
  }

  async rotate(familyId: string, presentedTokenId: string): Promise<RotationOutcome> {
    const nextTokenId = randomUUID();

    let result: unknown;
    try {
      result = await this.redis.eval(
        ROTATE_SCRIPT,
        2,
        familyKey(familyId),
        graceKey(familyId, presentedTokenId),
        presentedTokenId,
        nextTokenId,
        String(this.config.core.AUTH_REFRESH_GRACE_SECONDS),
        String(this.refreshTtl),
      );
    } catch (error) {
      this.logger.error(
        `session registry unreachable during rotation (family ${familyId})`,
        error instanceof Error ? error.stack : String(error),
      );
      return { status: 'unavailable' };
    }

    const reply = Array.isArray(result) ? result : [];
    const status = String(reply[0] ?? 'unknown');

    if (status === 'rotated') return { status: 'rotated', handle: { familyId, tokenId: nextTokenId } };
    // The racer is handed the token the winner installed, not a new one.
    if (status === 'raced') return { status: 'raced', handle: { familyId, tokenId: String(reply[1]) } };
    if (status === 'reuse') return { status: 'reuse-detected' };
    return { status: 'unknown' };
  }

  /** Ends one lineage — an ordinary sign-out. */
  async revokeFamily(familyId: string): Promise<void> {
    const owner = await this.redis.hmget(familyKey(familyId), 'tenantId', 'userId').catch(() => null);
    await this.denylist([familyId]);

    const [tenantId, userId] = owner ?? [];
    if (tenantId && userId) {
      await this.redis.srem(userKey(tenantId, userId), familyId).catch(() => 0);
    }
  }

  /**
   * The security logout. Ends EVERY session the account holds.
   *
   * Deliberately wider than the compromised family: a token that reached an
   * attacker gives no basis for assuming the rest of the account's sessions
   * are clean, and the cost of being wrong is asymmetric — a legitimate user
   * signs in again, a retained attacker session does not have to.
   */
  async revokeAllForUser(tenantId: string, userId: string): Promise<number> {
    const families = await this.redis.smembers(userKey(tenantId, userId)).catch(() => [] as string[]);
    await this.denylist(families);
    await this.redis.del(userKey(tenantId, userId)).catch(() => 0);
    return families.length;
  }

  /**
   * Whether a family has been revoked — consulted by the request guard.
   *
   * Access tokens are stateless and live for 15 minutes, so without this check
   * revocation would not actually end a session: it would stop the next
   * refresh while leaving the current access token working. This is what makes
   * "revoke" mean revoke.
   */
  async isRevoked(familyId: string): Promise<boolean> {
    try {
      return (await this.redis.exists(revokedKey(familyId))) === 1;
    } catch (error) {
      /*
       * Fail OPEN here, and only here.
       *
       * Failing closed on this path would turn a Redis blip into a total API
       * outage for every authenticated request. The exposure it trades for is
       * bounded: a revoked access token stays usable until it expires, at most
       * one access TTL. The refresh path makes the opposite call, because
       * there the safe answer is cheap.
       */
      this.logger.error(
        `revocation check failed for family ${familyId}; allowing the request`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  /**
   * Drops each family and marks it denied.
   *
   * The marker only has to outlive the access tokens already in circulation —
   * after that they expire on their own — so it is kept for one access TTL
   * plus a margin rather than the full refresh lifetime.
   */
  private async denylist(familyIds: string[]): Promise<void> {
    if (familyIds.length === 0) return;

    const markerTtl = this.config.core.JWT_ACCESS_TTL_SECONDS + 60;
    const pipeline = this.redis.multi();
    for (const familyId of familyIds) {
      pipeline.del(familyKey(familyId));
      pipeline.set(revokedKey(familyId), '1', 'EX', markerTtl);
    }
    await pipeline.exec().catch((error: unknown) => {
      this.logger.error(
        `failed to denylist ${familyIds.length} session family/families`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    });
  }
}
