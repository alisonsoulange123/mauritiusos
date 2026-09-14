import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, vector } from 'drizzle-orm/pg-core';
import { tenantIndexes, tenantScoped } from '@reef-technologies/db';

export const knowledgeItems = pgTable(
  'knowledge_items',
  {
    ...tenantScoped(),
    title: text('title').notNull(),
    slug: text('slug').notNull(),
    type: text('type', { enum: ['RULE', 'GUIDE', 'LOCATION', 'PROCESS', 'FAQ', 'DOCUMENT'] }).notNull(),
    category: text('category').notNull(),
    content: text('content').notNull(),
    locale: text('locale').notNull().default('en'),
    status: text('status', { enum: ['draft', 'review', 'published', 'archived'] }).notNull().default('draft'),
    /** 0–100. Decays as verification ages; see KNOWLEDGE_VERIFICATION_TTL_DAYS. */
    confidenceScore: integer('confidence_score').notNull().default(80),
    sourceId: uuid('source_id'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    ...tenantIndexes('knowledge_items')(table),
    uniqueIndex('knowledge_items_tenant_slug_locale_key').on(table.tenantId, table.slug, table.locale),
    index('knowledge_items_category_idx').on(table.tenantId, table.category, table.status),
  ],
);

/** Provenance. No knowledge item is served without a traceable source. */
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    ...tenantScoped(),
    name: text('name').notNull(),
    sourceType: text('source_type', { enum: ['government', 'partner', 'editorial', 'community'] }).notNull(),
    url: text('url'),
    authorityLevel: text('authority_level', { enum: ['official', 'partner', 'editorial', 'community'] })
      .notNull()
      .default('editorial'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
  },
  (table) => tenantIndexes('knowledge_sources')(table),
);

/**
 * Vector index for RAG (AI blueprint §8).
 *
 * 1536 dimensions matches text-embedding-3-small. HNSW over IVFFlat: it needs
 * no training pass, so a freshly seeded tenant returns good results
 * immediately rather than after a rebuild.
 */
export const knowledgeEmbeddings = pgTable(
  'knowledge_embeddings',
  {
    ...tenantScoped(),
    knowledgeId: uuid('knowledge_id').notNull(),
    /** Chunk index — long articles embed as several vectors. */
    chunkIndex: integer('chunk_index').notNull().default(0),
    chunkText: text('chunk_text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    model: text('model').notNull().default('text-embedding-3-small'),
  },
  (table) => [
    index('knowledge_embeddings_knowledge_idx').on(table.knowledgeId),
    index('knowledge_embeddings_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

/** The Knowledge Graph edges (DDD §3, "requires", "suitable_for", …). */
export const knowledgeRelations = pgTable(
  'knowledge_relations',
  {
    ...tenantScoped(),
    fromEntity: text('from_entity').notNull(),
    fromId: uuid('from_id').notNull(),
    relationType: text('relation_type', {
      enum: ['requires', 'suitable_for', 'depends_on', 'located_in', 'recommended_with', 'supersedes'],
    }).notNull(),
    toEntity: text('to_entity').notNull(),
    toId: uuid('to_id').notNull(),
  },
  (table) => [
    ...tenantIndexes('knowledge_relations')(table),
    index('knowledge_relations_from_idx').on(table.fromEntity, table.fromId),
    index('knowledge_relations_to_idx').on(table.toEntity, table.toId),
  ],
);
