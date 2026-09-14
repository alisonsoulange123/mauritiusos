import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { users } from '../infrastructure/identity.schema.js';
import { RecoveryMailer } from '../infrastructure/recovery-mailer.js';

/**
 * "I forgot my password."
 *
 * Returns nothing, always, and the controller answers 202 either way. Every
 * observable — status code, body, error shape — is identical for a registered
 * address and an unknown one, because a form that distinguishes them is a
 * membership oracle: feed it a breach dump and it tells you who has an
 * account here.
 *
 * The residual signal is timing. Issuing a token and handing a message to the
 * provider takes longer than doing nothing, and that difference is not erased
 * here. What bounds it is the throttle on the route — ten attempts a minute
 * makes a timing sweep of any real address list impractical — and closing it
 * properly means moving delivery onto the queue, which is where it belongs
 * once there is one.
 */
@Injectable()
export class RequestPasswordResetUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly recovery: RecoveryMailer,
    private readonly audit: AuditService,
  ) {}

  async execute(email: string): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const normalized = email.trim().toLowerCase();

    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, normalized)))
      .limit(1);

    const user = rows[0];

    // Recorded whether or not it matched. A burst of requests for addresses
    // that do not exist is the shape of an enumeration attempt, and the audit
    // trail is the only place that pattern is visible.
    await this.audit.record({
      action: 'identity.password.reset_requested',
      resourceType: 'user',
      resourceId: user?.id,
      result: user ? 'success' : 'denied',
      metadata: { email: normalized },
    });

    // A suspended account gets no link. Password reset would otherwise be a
    // way back in for exactly the accounts someone decided to lock out.
    if (!user || user.status !== 'active') return;

    await this.recovery.sendPasswordReset({
      userId: user.id,
      tenantId,
      email: user.email,
      locale: user.locale,
    });
  }
}
