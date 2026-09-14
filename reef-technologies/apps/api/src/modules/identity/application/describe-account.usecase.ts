import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, type Role } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { users } from '../infrastructure/identity.schema.js';

export interface AccountView {
  id: string;
  email: string;
  roles: Role[];
  emailVerified: boolean;
}

/**
 * What `/auth/me` answers.
 *
 * Reads the row rather than echoing the token's claims. An access token lives
 * fifteen minutes, so a claim-only answer would keep telling a user their
 * address is unconfirmed for a quarter of an hour after they confirmed it —
 * and the banner asking them to confirm would still be there, which reads as
 * the feature being broken.
 *
 * The cost is one primary-key lookup on a call that already crossed the
 * network, and it has a second benefit: a deleted account stops resolving
 * immediately instead of when its token expires.
 */
@Injectable()
export class DescribeAccountUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
  ) {}

  async execute(userId: string): Promise<AccountView> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .limit(1);

    const user = rows[0];
    // A valid token for an account that is gone or suspended is not a session.
    if (!user || user.status !== 'active') {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'This session is no longer valid.', 401);
    }

    return {
      id: user.id,
      email: user.email,
      roles: [user.role],
      emailVerified: user.emailVerifiedAt !== null,
    };
  }
}
