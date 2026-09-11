import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, type Role } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { TokenService} from '../../../core/auth/token.service.js';
import { type TokenPair } from '../../../core/auth/token.service.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { users } from '../infrastructure/identity.schema.js';

@Injectable()
export class AuthenticateUserUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly tokens: TokenService,
    private readonly sessions: SessionRegistry,
    private readonly audit: AuditService,
  ) {}

  async execute(email: string, password: string): Promise<TokenPair & { userId: string; role: Role }> {
    const tenantId = this.tenantContext.requireTenantId();
    const normalized = email.trim().toLowerCase();

    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, normalized)))
      .limit(1);

    const user = rows[0];

    // Verify against a dummy hash when the user is absent, so the response
    // time does not reveal whether an email is registered.
    const hash = user?.passwordHash ?? DUMMY_HASH;
    const passwordValid = await argon2.verify(hash, password).catch(() => false);

    if (!user || !passwordValid || user.status !== 'active') {
      await this.audit.record({
        action: 'identity.login',
        resourceType: 'user',
        resourceId: user?.id,
        result: 'denied',
        metadata: { email: normalized },
      });
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'Invalid credentials.', 401);
    }

    await this.audit.record({ action: 'identity.login', resourceType: 'user', resourceId: user.id });

    // Every sign-in starts its own lineage, so revoking one device's session
    // does not have to mean revoking a token issued to another.
    const session = await this.sessions.open(user.id, tenantId);

    const pair = await this.tokens.issue({
      userId: user.id,
      tenantId,
      email: user.email,
      roles: [user.role],
      session,
    });
    return { ...pair, userId: user.id, role: user.role };
  }
}

/** A real Argon2id hash of a random string — used only for timing parity. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
