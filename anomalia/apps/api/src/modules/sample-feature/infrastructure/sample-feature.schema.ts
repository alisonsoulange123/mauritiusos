import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@anomalia/db';

/**
 * This module's tables — owned here, not in a central schema file.
 *
 * `drizzle.config.ts` globs `modules/*\/infrastructure/*.schema.ts`, so this
 * file is discovered automatically: `pnpm db:generate` produces the migration
 * with no central registration. Delete the module directory and the next
 * generated migration drops its tables. That is what "no side-effects on the
 * core system" means at the persistence layer.
 *
 * Table names are module-prefixed to keep ownership obvious in psql.
 */
export const sampleItems = pgTable(
  'sample_items',
  {
    ...tenantScoped(),
    ownerId: uuid('owner_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    status: text('status', { enum: ['draft', 'active', 'archived'] }).notNull().default('draft'),
  },
  (table) => [
    ...tenantIndexes('sample_items')(table),
    // Uniqueness is per-tenant, never global: two tenants may legitimately
    // use the same title, and a global constraint would leak their existence.
    uniqueIndex('sample_items_tenant_title_key').on(table.tenantId, table.title),
  ],
);

export type SampleItemRow = typeof sampleItems.$inferSelect;
export type SampleItemInsert = typeof sampleItems.$inferInsert;
