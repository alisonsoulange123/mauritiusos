import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@reef-technologies/db';

export const assessments = pgTable(
  'assessment_sessions',
  {
    ...tenantScoped(),
    /** Null until the visitor registers — the funnel starts anonymous. */
    userId: uuid('user_id'),
    locale: text('locale').notNull().default('en'),
    acquisitionSource: text('acquisition_source'),
    status: text('status', { enum: ['started', 'completed', 'abandoned'] }).notNull().default('started'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
    score: integer('score'),
    primaryIntent: text('primary_intent'),
    /** The full recommendation, kept verbatim for auditability. */
    outcome: jsonb('outcome').$type<Record<string, unknown>>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    ...tenantIndexes('assessment_sessions')(table),
    index('assessment_sessions_status_idx').on(table.tenantId, table.status),
    index('assessment_sessions_user_idx').on(table.userId),
  ],
);
