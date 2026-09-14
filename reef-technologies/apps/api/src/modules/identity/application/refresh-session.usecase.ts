import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, type Role } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { TokenService } from '../../../core/auth/token.service.js';
import { type RefreshSubject, type TokenPair } from '../../../core/auth/token.service.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { users } from '../infrastructure/identity.schema.js';

/**
 * Exchanges a refresh token for a fresh pair, rotating it in the process.
 *
 * The access TTL is 15 minutes, so without this a visitor is signed out in the
 * middle of an assessment. The long-lived credential is the one the browser
 * never reads (httpOnly cookie) and the short-lived one is the only thing sent
 * to the API — which is the whole reason for splitting them.
 *
 * Each refresh retires the token it was given. Presenting a retired one means
 * two parties hold the same credential, and this is where that is acted on.
 *
 * Core verifies the signature and owns the session registry; this module
 * re-reads the user, because only identity knows whether an account is still
 * allowed to hold a session.
 */
@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly tokens: TokenService,
    private readonly sessions: SessionRegistry,
    private readonly audit: AuditService,
  ) {}

  async execute(refreshToken: string): Promise<TokenPair & { userId: string; role: Role }> {
    const tenantId = this.tenantContext.requireTenantId();
    const subject = await this.tokens.verifyRefresh(refreshToken);

    // A token minted for another tenant must not be redeemable here, exactly
    // as the request guard enforces for access tokens.
    if (subject.tenantId !== tenantId) {
      throw new DomainError(ERROR_CODES.FORBIDDEN, 'Token is not valid for this tenant.', 403);
    }

    const rotation = await this.sessions.rotate(subject.familyId, subject.tokenId);

    if (rotation.status === 'reuse-detected') await this.onReuseDetected(subject);

    /*
     * 'raced' is a success. Several requests from one page load can arrive
     * carrying the same token, and all but the first are handed the token the
     * winner installed rather than a new one — so the lineage advances once
     * per genuine refresh however many requests raced for it.
     */
    if (rotation.status !== 'rotated' && rotation.status !== 'raced') {
      /*
       * 'unavailable' lands here too, and that is deliberate: if the registry
       * cannot be read, reuse cannot be detected, and issuing tokens anyway
       * would quietly disable the protection exactly when something is already
       * wrong. Refusing costs the user a sign-in. The guard's revocation check
       * makes the opposite call, because there the cheap answer is the unsafe
       * one — see `SessionRegistry.isRevoked`.
       */
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired session.', 401);
    }

    const user = await this.loadActiveUser(tenantId, subject.userId);

    const pair = await this.tokens.issue({
      userId: user.id,
      tenantId,
      email: user.email,
      roles: [user.role],
      session: rotation.handle,
    });

    return { ...pair, userId: user.id, role: user.role };
  }

  /**
   * The security logout.
   *
   * There is no way to tell the attacker from the victim — both hold a token
   * from the same lineage — so every session on the account ends. The user
   * signs in again; whoever stole the token cannot, because they do not have
   * the password.
   *
   * Loud on purpose. This is the platform's only signal that a refresh token
   * left the browser it was issued to, and it should reach an alert, not just
   * a log file.
   */
  private async onReuseDetected(subject: RefreshSubject): Promise<void> {
    const revoked = await this.sessions.revokeAllForUser(subject.tenantId, subject.userId);

    this.logger.error(
      `REFRESH TOKEN REUSE user=${subject.userId} tenant=${subject.tenantId} ` +
        `family=${subject.familyId} — revoked ${revoked} session(s)`,
    );

    await this.audit.record({
      action: 'identity.session.reuse_detected',
      resourceType: 'session',
      resourceId: subject.familyId,
      result: 'denied',
      metadata: { userId: subject.userId, revokedFamilies: revoked },
    });
  }

  private async loadActiveUser(tenantId: string, userId: string) {
    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .limit(1);

    const user = rows[0];

    // Re-read rather than trust the token: suspending an account has to end
    // its session, not wait thirty days for the refresh token to expire.
    if (!user || user.status !== 'active') {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired session.', 401);
    }
    return user;
  }
}
