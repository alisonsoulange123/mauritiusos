import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { userProfiles } from '../infrastructure/identity.schema.js';
import { profilePatchFromAnswers, type ProfilePatch } from '../domain/profile-mapping.js';

export interface ProfileView {
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  currentCountry: string | null;
  birthDate: string | null;
  occupation: string | null;
  monthlyIncome: number | null;
  currency: string | null;
  familyStatus: 'single' | 'couple' | 'family' | null;
  journeyStage: string;
}

export type ProfileEdit = Partial<Omit<ProfileView, 'journeyStage'>>;

/**
 * Reading and writing a person's own profile.
 *
 * These columns are not decoration: the immigration rules engine matches on
 * nationality, age, income and family status, and the concierge restates its
 * verdict rather than inventing one. Until now the profile was written exactly
 * once — at registration, with a first name — so that verdict was computed
 * from nulls for every signed-in user.
 */
@Injectable()
export class ManageProfileUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<ProfileView> {
    const tenantId = this.tenantContext.requireTenantId();
    const row = await this.load(tenantId, userId);

    return {
      firstName: row.firstName,
      lastName: row.lastName,
      nationality: row.nationality,
      currentCountry: row.currentCountry,
      birthDate: row.birthDate,
      occupation: row.occupation,
      monthlyIncome: row.monthlyIncome,
      currency: row.currency,
      familyStatus: row.familyStatus,
      journeyStage: row.journeyStage,
    };
  }

  /** An explicit edit by the profile's owner. Wins over anything inferred. */
  async update(userId: string, edit: ProfileEdit): Promise<ProfileView> {
    const tenantId = this.tenantContext.requireTenantId();
    await this.load(tenantId, userId);

    // Only the keys actually supplied: a PATCH that omits a field must leave
    // it alone rather than blanking it.
    const changes = Object.fromEntries(
      Object.entries(edit).filter(([, value]) => value !== undefined),
    );

    if (Object.keys(changes).length > 0) {
      await this.database.runAsTenant(tenantId, async (tx) => {
        await tx
          .update(userProfiles)
          .set(changes)
          .where(and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)));
      });

      await this.audit.record({
        action: 'identity.profile.updated',
        resourceType: 'user_profile',
        resourceId: userId,
        // The field NAMES, never the values: a profile carries nationality,
        // income and family status, and an audit trail is a poor place to
        // duplicate someone's personal data.
        metadata: { fields: Object.keys(changes) },
      });
    }

    return this.get(userId);
  }

  /**
   * Enrichment from a completed assessment.
   *
   * Separate from `update` because it is a different kind of act: inferred
   * rather than stated, and therefore only allowed to fill what is empty. The
   * decision lives in the pure mapping; this just applies it.
   */
  async enrichFromAssessment(userId: string, answers: Record<string, unknown>): Promise<boolean> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)))
      .limit(1);

    const existing = rows[0];
    // An assessment can name a user who no longer exists; that is a stale
    // event, not a failure worth redelivering forever.
    if (!existing) return false;

    const patch = profilePatchFromAnswers(answers, existing);
    if (Object.keys(patch).length === 0) return false;

    await this.applyPatch(tenantId, userId, patch, existing.preferences);

    await this.audit.record({
      action: 'identity.profile.enriched',
      resourceType: 'user_profile',
      resourceId: userId,
      metadata: { fields: Object.keys(patch), source: 'assessment' },
    });
    return true;
  }

  private async applyPatch(
    tenantId: string,
    userId: string,
    patch: ProfilePatch,
    currentPreferences: Record<string, unknown>,
  ): Promise<void> {
    const { preferences, ...columns } = patch;

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(userProfiles)
        .set({
          ...columns,
          // Merged, not replaced: the bag is shared with whatever else comes
          // to live in it.
          ...(preferences ? { preferences: { ...currentPreferences, ...preferences } } : {}),
        })
        .where(and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)));
    });
  }

  private async load(tenantId: string, userId: string) {
    const rows = await this.database.db
      .select()
      .from(userProfiles)
      .where(and(eq(userProfiles.tenantId, tenantId), eq(userProfiles.userId, userId)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No profile for that account.', 404);
    return row;
  }
}
