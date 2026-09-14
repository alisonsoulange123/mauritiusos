import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { IDENTITY_CONTRACT, type IdentityContract, type UserProfileView } from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { userProfiles, users } from '../infrastructure/identity.schema.js';

/**
 * Read-only profile projection for other modules.
 *
 * Note what it does NOT expose: email, password hash, role. The immigration
 * engine needs an age and an income; giving it credentials as well would be a
 * least-privilege violation between modules, not just between users.
 */
@Injectable()
export class IdentityContractImpl implements IdentityContract, OnModuleInit {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly registry: ContractRegistry,
    private readonly tenantContext: TenantContext,
  ) {}

  onModuleInit(): void {
    this.registry.register(IDENTITY_CONTRACT, this, 'identity');
  }

  async getProfile(userId: string): Promise<UserProfileView | null> {
    const tenantId = this.tenantContext.requireTenantId();
    const rows = await this.database.db
      .select({
        userId: userProfiles.userId,
        nationality: userProfiles.nationality,
        birthDate: userProfiles.birthDate,
        monthlyIncome: userProfiles.monthlyIncome,
        currency: userProfiles.currency,
        familyStatus: userProfiles.familyStatus,
        locale: users.locale,
      })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      userId: row.userId,
      nationality: row.nationality,
      // Age is DERIVED, never stored: a stored age is wrong within a year.
      age: row.birthDate ? yearsSince(row.birthDate) : null,
      locale: row.locale,
      monthlyIncome: row.monthlyIncome,
      currency: row.currency,
      familyStatus: row.familyStatus,
    };
  }
}

const yearsSince = (isoDate: string): number => {
  const birth = new Date(isoDate);
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
};
