import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DomainError, EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { RecoveryTokenService } from '../../../core/auth/recovery-tokens.js';
import { users } from '../infrastructure/identity.schema.js';

export interface VerifyEmailResult {
  userId: string;
  email: string;
  /** False when the address was already confirmed — a repeat click, not an error. */
  changed: boolean;
}

/**
 * Redeems a verification link.
 *
 * What this actually establishes is narrow and worth stating: that whoever
 * clicked can read mail sent to that address. It is not proof of identity. It
 * is, however, the difference between an account tied to a mailbox somebody
 * controls and an account tied to a string somebody typed — which is why the
 * role policy will not promote past `lead` without it.
 */
@Injectable()
export class VerifyEmailUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly tokens: RecoveryTokenService,
    private readonly audit: AuditService,
  ) {}

  async execute(token: string): Promise<VerifyEmailResult> {
    const tenantId = this.tenantContext.requireTenantId();
    const subject = await this.tokens.consume('email-verify', token);

    // One message for expired, already-used, unknown and malformed alike.
    // Telling them apart would report on links the caller does not hold.
    if (!subject || subject.tenantId !== tenantId) {
      throw new DomainError(
        'IDENTITY_VERIFICATION_LINK_INVALID',
        'That confirmation link is no longer valid. Request a new one.',
        410,
      );
    }

    const updated = await this.database.runAsTenant(tenantId, async (tx) =>
      tx
        .update(users)
        .set({ emailVerifiedAt: new Date() })
        .where(
          and(
            eq(users.tenantId, tenantId),
            eq(users.id, subject.userId),
            // Only the first confirmation writes a timestamp, so a second
            // click cannot quietly move the date forward.
            isNull(users.emailVerifiedAt),
          ),
        )
        .returning({ id: users.id }),
    );

    const changed = updated.length > 0;

    if (changed) {
      await this.audit.record({
        action: 'identity.email.verified',
        resourceType: 'user',
        resourceId: subject.userId,
        metadata: { email: subject.email },
      });

      await this.events.publish('identity.email.verified', {
        userId: subject.userId,
        email: subject.email,
      });
    }

    return { userId: subject.userId, email: subject.email, changed };
  }
}
