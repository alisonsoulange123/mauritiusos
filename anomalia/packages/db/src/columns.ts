import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Shared column vocabulary.
 *
 * Every module defines its own tables inside its own directory — that is what
 * makes a module deletable. What they share is *shape*: identical id, tenant
 * and audit columns, so the tenancy helpers and audit tooling work across
 * tables written by teams that never spoke to each other.
 */

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

/**
 * Tenant discriminator (Security blueprint §18). Present on every
 * tenant-scoped table; queries go through `withTenant()` so the filter cannot
 * be forgotten, and a Postgres RLS policy backs it at the database level.
 */
export const tenantId = () => uuid('tenant_id').notNull();

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Soft delete — relocation cases and knowledge items are never hard-deleted. */
export const softDelete = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * The standard preamble for a tenant-scoped table.
 *
 * Usage inside a module:
 *   export const sampleItems = pgTable('sample_items', {
 *     ...tenantScoped(),
 *     title: text('title').notNull(),
 *   }, tenantIndexes('sample_items'));
 */
export const tenantScoped = () => ({
  id: primaryId(),
  tenantId: tenantId(),
  ...timestamps(),
});

/** Index helper: tenant-first composite indexes keep every query sargable. */
export const tenantIndexes =
  <T extends { tenantId: unknown; createdAt: unknown }>(tableName: string) =>
  (table: T) => [
    index(`${tableName}_tenant_idx`).on(table.tenantId as never),
    index(`${tableName}_tenant_created_idx`).on(table.tenantId as never, table.createdAt as never),
  ];

/** pgvector column for the knowledge embeddings table (AI blueprint §8). */
export const embeddingColumn = (name: string, dimensions = 1536) =>
  sql.raw(`${name} vector(${dimensions})`);

export { pgTable };
