import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  KNOWLEDGE_CONTRACT,
  type KnowledgeContract,
  type KnowledgeHit,
  type KnowledgeQuery,
} from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { knowledgeItems, knowledgeSources } from '../infrastructure/knowledge.schema.js';
import type { KnowledgeEnv } from './knowledge-env.js';

/**
 * Verified retrieval.
 *
 * This implementation does lexical search only. Semantic retrieval needs an
 * embedding of the query, which requires an LLM call — and the Engineering
 * Standards forbid the API calling an LLM directly (§2.4). The Python AI
 * worker owns embeddings and queries `knowledge_embeddings` itself; this
 * contract serves the synchronous, deterministic path that other modules and
 * the back office need.
 *
 * Every hit carries `confidence` and `sourceAuthority`, so a caller can decide
 * how much weight to give it. Stale items are filtered out rather than
 * silently served as current — a six-month-old permit rule is a liability.
 */
@Injectable()
export class KnowledgeContractImpl implements KnowledgeContract, OnModuleInit {
  private readonly logger = new Logger(KnowledgeContractImpl.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly registry: ContractRegistry,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(KNOWLEDGE_CONTRACT, this, 'knowledge');
  }

  async search(query: KnowledgeQuery): Promise<KnowledgeHit[]> {
    const tenantId = this.tenantContext.requireTenantId();
    const env = this.config.module<KnowledgeEnv>();
    const minConfidence = (query.minConfidence ?? env.KNOWLEDGE_MIN_CONFIDENCE) * 100;
    const locale = query.locale ?? this.tenantContext.locale();

    /*
     * Postgres full-text ranking, with both sides folded through `unaccent`.
     *
     * `websearch_to_tsquery` accepts what people actually type — quoted
     * phrases, `or`, `-exclusions` — instead of erroring on syntax the way
     * `to_tsquery` does.
     *
     * The `unaccent` calls are what make the French half of the knowledge base
     * reachable. Without them Postgres indexes 'société' and a reader typing
     * "societe" matches nothing: the content is live, correct, and invisible
     * to anyone on a keyboard without accents, which is most phones. The
     * extension has been installed since the first migration, with a comment
     * saying it was there "so Rivière matches Riviere" — it simply was never
     * used. Folding BOTH sides is the point; folding one changes which
     * mismatch you get, not whether you get one.
     */
    const searchable = sql`unaccent(${knowledgeItems.title} || ' ' || ${knowledgeItems.content})`;
    const searchQuery = sql`websearch_to_tsquery('simple', unaccent(${query.query}))`;

    const rankExpression = sql<number>`ts_rank(to_tsvector('simple', ${searchable}), ${searchQuery})`;

    const rows = await this.database.db
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        slug: knowledgeItems.slug,
        type: knowledgeItems.type,
        content: knowledgeItems.content,
        confidence: knowledgeItems.confidenceScore,
        verifiedAt: knowledgeItems.verifiedAt,
        authority: knowledgeSources.authorityLevel,
        rank: rankExpression,
      })
      .from(knowledgeItems)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeItems.sourceId))
      .where(
        and(
          eq(knowledgeItems.tenantId, tenantId),
          eq(knowledgeItems.status, 'published'),
          eq(knowledgeItems.locale, locale),
          sql`${knowledgeItems.confidenceScore} >= ${minConfidence}`,
          query.category ? eq(knowledgeItems.category, query.category) : undefined,
          sql`to_tsvector('simple', ${searchable}) @@ ${searchQuery}`,
          // Freshness gate: unverified-for-too-long items are withheld.
          sql`(${knowledgeItems.verifiedAt} IS NULL
               OR ${knowledgeItems.verifiedAt} > now() - (${env.KNOWLEDGE_VERIFICATION_TTL_DAYS} || ' days')::interval)`,
        ),
      )
      .orderBy(desc(rankExpression), desc(knowledgeItems.confidenceScore))
      .limit(query.limit ?? env.KNOWLEDGE_SEARCH_LIMIT);

    return rows.map((row) => ({
      knowledgeId: row.id,
      title: row.title,
      slug: row.slug,
      type: row.type,
      excerpt: excerpt(row.content),
      confidence: row.confidence / 100,
      sourceAuthority: row.authority ?? 'editorial',
      lastVerifiedAt: row.verifiedAt?.toISOString() ?? null,
    }));
  }

  async getBySlug(slug: string, locale: string): Promise<KnowledgeHit | null> {
    const tenantId = this.tenantContext.requireTenantId();
    const rows = await this.database.db
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        slug: knowledgeItems.slug,
        type: knowledgeItems.type,
        content: knowledgeItems.content,
        confidence: knowledgeItems.confidenceScore,
        verifiedAt: knowledgeItems.verifiedAt,
        authority: knowledgeSources.authorityLevel,
      })
      .from(knowledgeItems)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeItems.sourceId))
      .where(
        and(
          eq(knowledgeItems.tenantId, tenantId),
          eq(knowledgeItems.slug, slug),
          eq(knowledgeItems.locale, locale),
          eq(knowledgeItems.status, 'published'),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      knowledgeId: row.id,
      title: row.title,
      slug: row.slug,
      type: row.type,
      excerpt: row.content,
      confidence: row.confidence / 100,
      sourceAuthority: row.authority ?? 'editorial',
      lastVerifiedAt: row.verifiedAt?.toISOString() ?? null,
    };
  }
}

/** Cuts at a word boundary so excerpts never end mid-word. */
const excerpt = (content: string, length = 280): string => {
  if (content.length <= length) return content;
  const cut = content.slice(0, length);
  const lastSpace = cut.lastIndexOf(' ');
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
};
