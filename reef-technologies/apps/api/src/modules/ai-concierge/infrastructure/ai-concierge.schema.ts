import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@reef-technologies/db';

/** Short-term memory: the current conversation (AI blueprint §7). */
export const aiSessions = pgTable(
  'ai_sessions',
  {
    ...tenantScoped(),
    userId: uuid('user_id').notNull(),
    locale: text('locale').notNull().default('en'),
    /** Detected intent, refreshed as the conversation develops. */
    primaryIntent: text('primary_intent'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [...tenantIndexes('ai_sessions')(table), index('ai_sessions_user_idx').on(table.userId)],
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    ...tenantScoped(),
    sessionId: uuid('session_id').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    /** Knowledge ids cited — makes an answer auditable after the fact. */
    citations: jsonb('citations').$type<string[]>().notNull().default([]),
    confidence: integer('confidence'),
    /** Token accounting for the AI cost metrics in §23. */
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
  },
  (table) => [
    ...tenantIndexes('ai_messages')(table),
    index('ai_messages_session_idx').on(table.sessionId, table.createdAt),
  ],
);

/**
 * Long-term memory (AI blueprint §7). Distinct from the profile: a profile is
 * declared facts, memory is inferred preference ("prefers French-speaking
 * services"), which is why it carries an importance weight and is pruned.
 */
export const userMemory = pgTable(
  'ai_user_memory',
  {
    ...tenantScoped(),
    userId: uuid('user_id').notNull(),
    memoryType: text('memory_type').notNull(),
    memoryKey: text('memory_key').notNull(),
    memoryValue: text('memory_value').notNull(),
    importance: integer('importance').notNull().default(50),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    ...tenantIndexes('ai_user_memory')(table),
    index('ai_user_memory_user_idx').on(table.userId, table.importance),
  ],
);
