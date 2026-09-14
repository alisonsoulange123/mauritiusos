import { Injectable, Logger } from '@nestjs/common';
import { TokenService } from '../../../core/auth/token.service.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { AuditService } from '../../../core/audit/audit.service.js';

/**
 * Sign-out, server side.
 *
 * Clearing the cookie only removes the browser's copy. The refresh token
 * itself stays valid for its full thirty days, so a token captured before
 * sign-out would still mint sessions afterwards — on a shared machine, "log
 * out" would mean almost nothing. This ends the lineage where it actually
 * lives.
 *
 * Deliberately quiet about failure: an unparseable or already-revoked token
 * still reports success. The caller is signing out, the outcome they want is
 * "this token no longer works", and that is true either way. Returning an
 * error would only tell an attacker which tokens are real.
 */
@Injectable()
export class RevokeSessionUseCase {
  private readonly logger = new Logger(RevokeSessionUseCase.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionRegistry,
    private readonly audit: AuditService,
  ) {}

  async execute(refreshToken: string): Promise<void> {
    let familyId: string;
    try {
      familyId = (await this.tokens.verifyRefresh(refreshToken)).familyId;
    } catch {
      return;
    }

    try {
      await this.sessions.revokeFamily(familyId);
    } catch (error) {
      // Worth knowing about: the session outlives the sign-out until it
      // expires, which is a security-relevant failure even though the user
      // sees a clean sign-out.
      this.logger.error(
        `sign-out could not revoke session family ${familyId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return;
    }

    await this.audit.record({
      action: 'identity.logout',
      resourceType: 'session',
      resourceId: familyId,
    });
  }
}
