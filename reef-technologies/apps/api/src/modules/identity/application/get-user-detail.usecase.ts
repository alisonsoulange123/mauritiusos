import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, type Role } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { userProfiles, users } from '../infrastructure/identity.schema.js';

export interface UserDetail {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'active' | 'suspended';
  emailVerified: boolean;
  emailVerifiedAt: Date | null;
  locale: string;
  createdAt: Date;
  profile: {
    firstName: string | null;
    lastName: string | null;
    nationality: string | null;
    currentCountry: string | null;
    occupation: string | null;
    journeyStage: string | null;
  } | null;
  /** Roughly how many devices hold a live session. */
  activeSessions: number;
}

/**
 * One account, as an operator needs to see it.
 *
 * Deliberately more than the directory row: whether the address is confirmed
 * and when, and how many sessions are live. Those two answer most of what a
 * support conversation is actually about — "why can't they be upgraded" and
 * "are they still signed in somewhere".
 *
 * What it does NOT return is the password hash. The row is selected by column
 * rather than with `select()`, so adding a sensitive column to the table
 * later cannot quietly widen this response.
 */
@Injectable()
export class GetUserDetailUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly sessions: SessionRegistry,
  ) {}

  async execute(userId: string): Promise<UserDetail> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        locale: users.locale,
        createdAt: users.createdAt,
        firstName: userProfiles.firstName,
        lastName: userProfiles.lastName,
        nationality: userProfiles.nationality,
        currentCountry: userProfiles.currentCountry,
        occupation: userProfiles.occupation,
        journeyStage: userProfiles.journeyStage,
      })
      .from(users)
      .leftJoin(
        userProfiles,
        and(eq(userProfiles.userId, users.id), eq(userProfiles.tenantId, tenantId)),
      )
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)))
      .limit(1);

    const row = rows[0];
    // Tenant-scoped, so a user in another tenant is not found rather than
    // forbidden — confirming the id exists is itself a disclosure.
    if (!row) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such user.', 404);

    return {
      id: row.id,
      email: row.email,
      role: row.role,
      status: row.status,
      emailVerified: row.emailVerifiedAt !== null,
      emailVerifiedAt: row.emailVerifiedAt,
      locale: row.locale,
      createdAt: row.createdAt,
      profile: row.journeyStage
        ? {
            firstName: row.firstName,
            lastName: row.lastName,
            nationality: row.nationality,
            currentCountry: row.currentCountry,
            occupation: row.occupation,
            journeyStage: row.journeyStage,
          }
        : null,
      activeSessions: await this.sessions.activeSessionCount(tenantId, row.id),
    };
  }
}
