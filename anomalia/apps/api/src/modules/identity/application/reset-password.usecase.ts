import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { RecoveryTokenService } from '../../../core/auth/recovery-tokens.js';
import { users } from '../infrastructure/identity.schema.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import { RecoveryMailer } from '../infrastructure/recovery-mailer.js';

export interface ResetPasswordResult {
  userId: string;
  /** Ended by the reset — surfaced so the UI can say the other devices are out. */
  sessionsRevoked: number;
}

/**
 * Redeems a reset link and sets a new password.
 *
 * The reset itself is the easy half. The rest of this use case exists because
 * a password reset is the standard last step of an account takeover, so it has
 * to behave correctly when the person holding the link is not the owner:
 *
 *   • every session on the account is ended, so a session the attacker opened
 *     earlier does not survive the owner's recovery — and vice versa;
 *   • the owner is told, at the address on file, that it happened;
 *   • the link dies on use, so reading the mailbox later buys nothing.
 */
@Injectable()
export class ResetPasswordUseCase {
  private readonly logger = new Logger(ResetPasswordUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly tokens: RecoveryTokenService,
    private readonly sessions: SessionRegistry,
    private readonly passwords: PasswordHasher,
    private readonly recovery: RecoveryMailer,
    private readonly audit: AuditService,
  ) {}

  async execute(token: string, newPassword: string): Promise<ResetPasswordResult> {
    const tenantId = this.tenantContext.requireTenantId();

    // Before consuming anything: the token is single-use, so a rejected
    // password must not cost the user their link.
    this.passwords.assertAcceptable(newPassword);

    const subject = await this.tokens.consume('password-reset', token);
    if (!subject || subject.tenantId !== tenantId) {
      throw new DomainError(
        'IDENTITY_RESET_LINK_INVALID',
        'That reset link is no longer valid. Request a new one.',
        410,
      );
    }

    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, subject.userId)))
      .limit(1);

    const user = rows[0];
    if (!user || user.status !== 'active') {
      // The account was suspended or removed between the link being sent and
      // used. Same message as an invalid link: the state of someone else's
      // account is not this caller's to learn.
      throw new DomainError(
        'IDENTITY_RESET_LINK_INVALID',
        'That reset link is no longer valid. Request a new one.',
        410,
      );
    }

    const passwordHash = await this.passwords.hash(newPassword);

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash,
          /*
           * Completing a reset proves the mailbox was read, which is exactly
           * what the verification flow asks for — so it counts. Doing anything
           * else would leave a recovered account unable to be promoted until
           * the owner clicked a second link proving the same thing twice.
           */
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
        })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, user.id)));
    });

    /*
     * Everything, not just this device.
     *
     * Someone resetting a password is either recovering an account or has just
     * taken one over, and the two are indistinguishable from here. Ending all
     * sessions is right in both readings: it evicts an attacker who already
     * had one, and it costs a legitimate owner a single sign-in.
     */
    const sessionsRevoked = await this.sessions.revokeAllForUser(tenantId, user.id);

    await this.audit.record({
      action: 'identity.password.reset',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { email: user.email, sessionsRevoked },
    });

    await this.events.publish('identity.password.reset', { userId: user.id, sessionsRevoked });

    // Last, and to the address on file rather than anything in the request.
    // If the reset was not the owner's doing, this is the only notice they get.
    await this.recovery.sendPasswordChangedNotice(user.email, user.locale);

    this.logger.log(`password reset for ${user.id} (${sessionsRevoked} session(s) ended)`);

    return { userId: user.id, sessionsRevoked };
  }
}
