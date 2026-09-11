import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from '@anomalia/db';

/**
 * CORE tables only — the ones that exist before any module does.
 *
 * Note what is NOT here: no users table, no knowledge table, no assessments.
 * Those belong to their modules. Core owns tenancy and the audit trail,
 * because both are cross-cutting by definition.
 */

/** Tenant = one Country Pack (Security blueprint §17). */
export const tenants = pgTable(
  'tenants',
  {
    id: primaryId(),
    /** URL/host segment: `mauritius`, `portugal`. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    /** ISO 3166-1 alpha-2. */
    country: text('country').notNull(),
    defaultLocale: text('default_locale').notNull().default('en'),
    supportedLocales: jsonb('supported_locales').$type<string[]>().notNull().default(['en']),
    currency: text('currency').notNull().default('MUR'),
    timezone: text('timezone').notNull().default('Indian/Mauritius'),
    /** Per-tenant branding and overrides; deliberately schemaless. */
    branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
    /** Per-tenant module overrides, layered over the FEATURE_* env flags. */
    featureOverrides: jsonb('feature_overrides').$type<Record<string, boolean>>().notNull().default({}),
    status: text('status', { enum: ['active', 'suspended', 'provisioning'] }).notNull().default('provisioning'),
    ...timestamps(),
  },
  (table) => [uniqueIndex('tenants_slug_key').on(table.slug)],
);

/**
 * Append-only audit trail (Security blueprint §13).
 *
 * Not tenant-scoped via RLS: platform operators must be able to read across
 * tenants during an investigation. Writes go through AuditService only.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: primaryId(),
    tenantId: uuid('tenant_id'),
    actorId: uuid('actor_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id'),
    /** `success` or a failure reason — failed attempts matter most. */
    result: text('result', { enum: ['success', 'denied', 'error'] }).notNull(),
    traceId: text('trace_id').notNull(),
    ipAddress: text('ip_address'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_log_tenant_time_idx').on(table.tenantId, table.occurredAt),
    index('audit_log_actor_idx').on(table.actorId),
    index('audit_log_resource_idx').on(table.resourceType, table.resourceId),
  ],
);

/** Processed-event ledger: the idempotency backstop for at-least-once delivery. */
export const processedEvents = pgTable(
  'processed_events',
  {
    eventId: uuid('event_id').primaryKey(),
    eventName: text('event_name').notNull(),
    /** Same event, different consumer — hence the composite uniqueness below. */
    consumer: text('consumer').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    succeeded: boolean('succeeded').notNull().default(true),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('processed_events_key').on(table.eventId, table.consumer)],
);
