import { boolean, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@anomalia/db';

/**
 * Rules are TENANT-SCOPED, which is the mechanism behind the Country Pack
 * model: MauritiusOS and PortugalOS run identical code and differ only in the
 * rows here. Adding a country is a data migration, not a fork.
 */
export const immigrationRules = pgTable(
  'immigration_rules',
  {
    ...tenantScoped(),
    name: text('name').notNull(),
    permitType: text('permit_type').notNull(),
    description: text('description'),
    requiredDocuments: jsonb('required_documents').$type<string[]>().notNull().default([]),
    /** 0–100; how authoritative the source behind this rule is. */
    baseConfidence: integer('base_confidence').notNull().default(90),
    active: boolean('active').notNull().default(true),
    /** Provenance — every rule traces to a government source. */
    sourceUrl: text('source_url'),
    verifiedAt: text('verified_at'),
  },
  (table) => [
    ...tenantIndexes('immigration_rules')(table),
    index('immigration_rules_permit_idx').on(table.tenantId, table.permitType),
  ],
);

export const ruleConditions = pgTable(
  'immigration_rule_conditions',
  {
    ...tenantScoped(),
    ruleId: uuid('rule_id').notNull(),
    /** Fact key: `age`, `monthlyIncome`, `nationality`, `familyStatus`. */
    field: text('field').notNull(),
    operator: text('operator', {
      enum: ['eq', 'ne', 'gte', 'lte', 'gt', 'lt', 'in', 'not_in'],
    }).notNull(),
    value: text('value').notNull(),
    weight: integer('weight').notNull().default(1),
  },
  (table) => [
    ...tenantIndexes('immigration_rule_conditions')(table),
    index('immigration_rule_conditions_rule_idx').on(table.ruleId),
  ],
);
