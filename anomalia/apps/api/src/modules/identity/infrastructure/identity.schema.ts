import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@anomalia/db';

/** Technical identity. Credentials live here and nowhere else. */
export const users = pgTable(
  'identity_users',
  {
    ...tenantScoped(),
    email: text('email').notNull(),
    /** Argon2id. Never bcrypt for new hashes; never plaintext, obviously. */
    passwordHash: text('password_hash'),
    role: text('role', {
      enum: ['visitor', 'lead', 'client', 'advisor', 'knowledge_manager', 'partner', 'admin'],
    })
      .notNull()
      .default('lead'),
    status: text('status', { enum: ['pending', 'active', 'suspended'] }).notNull().default('pending'),
    /**
     * When the owner proved they can read this address — null until they do.
     *
     * A timestamp rather than a boolean because "verified" is an event with a
     * date, and support will eventually need to know whether it happened
     * before or after some other thing.
     */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    locale: text('locale').notNull().default('en'),
  },
  (table) => [
    ...tenantIndexes('identity_users')(table),
    // Per-tenant uniqueness: the same person may exist in MauritiusOS and
    // PortugalOS as separate users with separate consent.
    uniqueIndex('identity_users_tenant_email_key').on(table.tenantId, table.email),
  ],
);

/** Business profile — the domain data the AI and rules engine reason over. */
export const userProfiles = pgTable(
  'identity_user_profiles',
  {
    ...tenantScoped(),
    userId: uuid('user_id').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    nationality: text('nationality'),
    currentCountry: text('current_country'),
    birthDate: date('birth_date'),
    occupation: text('occupation'),
    monthlyIncome: integer('monthly_income'),
    currency: text('currency'),
    familyStatus: text('family_status', { enum: ['single', 'couple', 'family'] }),
    /** Journey stage: visitor → lead → planner → resident → investor. */
    journeyStage: text('journey_stage').notNull().default('visitor'),
    preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    ...tenantIndexes('identity_user_profiles')(table),
    index('identity_user_profiles_user_idx').on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserProfileRow = typeof userProfiles.$inferSelect;
