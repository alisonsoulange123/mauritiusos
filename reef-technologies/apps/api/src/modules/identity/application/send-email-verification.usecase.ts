import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { users } from '../infrastructure/identity.schema.js';
import { RecoveryMailer } from '../infrastructure/recovery-mailer.js';

export interface SendEmailVerificationResult {
  sent: boolean;
  alreadyVerified: boolean;
}

/**
 * Sends a fresh confirmation link to the signed-in user's own address.
 *
 * Authenticated, and always to the address on the account rather than one
 * supplied in the request. A public "resend to this address" endpoint would be
 * both an enumeration oracle and a way to have the platform mail anyone on
 * demand; this can only ever mail the person asking.
 */
@Injectable()
export class SendEmailVerificationUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly recovery: RecoveryMailer,
    private readonly audit: AuditService,
  ) {}

  async execute(userId: string): Promise<SendEmailVerificationResult> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .limit(1);

    const user = rows[0];
    if (!user) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such user.', 404);

    // Already done. Reported rather than refused: the caller asked for an
    // outcome that is already true.
    if (user.emailVerifiedAt) return { sent: false, alreadyVerified: true };

    await this.recovery.sendEmailVerification({
      userId: user.id,
      tenantId,
      email: user.email,
      locale: user.locale,
    });

    await this.audit.record({
      action: 'identity.email.verification_sent',
      resourceType: 'user',
      resourceId: user.id,
    });

    return { sent: true, alreadyVerified: false };
  }
}
