import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { DomainError, ERROR_CODES, type Page } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../../core/http/cursor.js';
import { knowledgeItems, knowledgeSources } from '../infrastructure/knowledge.schema.js';
import { allowedTransitions, type KnowledgeStatus } from '../domain/publication-policy.js';
import type { KnowledgeEnv } from './knowledge-env.js';

export interface BrowseKnowledgeQuery {
  status?: KnowledgeStatus;
  category?: string;
  locale?: string;
  search?: string;
  /** Published items whose verification has lapsed — what search is withholding. */
  staleOnly?: boolean;
  cursor?: string;
  limit: number;
}

export interface KnowledgeSummary {
  id: string;
  title: string;
  slug: string;
  type: string;
  category: string;
  locale: string;
  status: KnowledgeStatus;
  confidenceScore: number;
  verifiedAt: Date | null;
  sourceName: string | null;
  stale: boolean;
  createdAt: Date;
}

export interface KnowledgeDetail extends KnowledgeSummary {
  content: string;
  sourceId: string | null;
  sourceAuthority: string | null;
  /** What this item may become next, so a UI need not re-implement the policy. */
  nextStates: readonly KnowledgeStatus[];
  editable: boolean;
}

/**
 * The editorial view of the knowledge base.
 *
 * Distinct from the public `search` on the contract, and deliberately so:
 * search exists to serve only what is publishable — published, in-locale,
 * above the confidence floor, verified recently enough — while this exists to
 * show an editor everything, *including* the items search is refusing to
 * serve, which are precisely the ones needing attention.
 */
@Injectable()
export class BrowseKnowledgeUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  private get ttlDays(): number {
    return this.config.module<KnowledgeEnv>().KNOWLEDGE_VERIFICATION_TTL_DAYS;
  }

  async list(query: BrowseKnowledgeQuery): Promise<Page<KnowledgeSummary>> {
    const tenantId = this.tenantContext.requireTenantId();
    const cursor = decodeTimeCursor(query.cursor);

    const filters: Array<SQL | undefined> = [
      eq(knowledgeItems.tenantId, tenantId),
      query.status ? eq(knowledgeItems.status, query.status) : undefined,
      query.category ? eq(knowledgeItems.category, query.category) : undefined,
      query.locale ? eq(knowledgeItems.locale, query.locale) : undefined,
      query.search ? searchFilter(query.search) : undefined,
      // Only published items can be "stale" in the sense that matters: a stale
      // draft is just a draft.
      query.staleOnly
        ? and(eq(knowledgeItems.status, 'published'), this.expiredPredicate())
        : undefined,
      cursor
        ? sql`(${knowledgeItems.createdAt}, ${knowledgeItems.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    ];

    const rows = await this.database.db
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        slug: knowledgeItems.slug,
        type: knowledgeItems.type,
        category: knowledgeItems.category,
        locale: knowledgeItems.locale,
        status: knowledgeItems.status,
        confidenceScore: knowledgeItems.confidenceScore,
        verifiedAt: knowledgeItems.verifiedAt,
        createdAt: knowledgeItems.createdAt,
        sourceName: knowledgeSources.name,
        stale: this.expiredPredicate(),
      })
      .from(knowledgeItems)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeItems.sourceId))
      .where(and(...filters.filter((filter): filter is SQL => filter !== undefined)))
      .orderBy(desc(knowledgeItems.createdAt), desc(knowledgeItems.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({ ...row, status: row.status as KnowledgeStatus })),
      nextCursor: hasMore && last ? encodeTimeCursor(last.createdAt, last.id) : null,
    };
  }

  async get(id: string): Promise<KnowledgeDetail> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select({
        id: knowledgeItems.id,
        title: knowledgeItems.title,
        slug: knowledgeItems.slug,
        type: knowledgeItems.type,
        category: knowledgeItems.category,
        locale: knowledgeItems.locale,
        status: knowledgeItems.status,
        content: knowledgeItems.content,
        confidenceScore: knowledgeItems.confidenceScore,
        verifiedAt: knowledgeItems.verifiedAt,
        createdAt: knowledgeItems.createdAt,
        sourceId: knowledgeItems.sourceId,
        sourceName: knowledgeSources.name,
        sourceAuthority: knowledgeSources.authorityLevel,
        stale: this.expiredPredicate(),
      })
      .from(knowledgeItems)
      .leftJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeItems.sourceId))
      .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)))
      .limit(1);

    const row = rows[0];
    if (!row) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such knowledge item.', 404);

    const status = row.status as KnowledgeStatus;
    return {
      ...row,
      status,
      // Derived from the policy and sent to the client, so the editor's options
      // and the server's rules cannot disagree.
      nextStates: allowedTransitions(status),
      editable: status !== 'published',
    };
  }

  /**
   * Staleness, computed in SQL rather than in Node.
   *
   * It has to be a predicate to be filterable, and computing it twice — once
   * for the filter and once for the flag — is how the list ends up showing a
   * badge that disagrees with the filter that produced the row.
   */
  private expiredPredicate(): SQL<boolean> {
    return sql<boolean>`(${knowledgeItems.verifiedAt} IS NOT NULL
      AND ${knowledgeItems.verifiedAt} <= now() - (${this.ttlDays} || ' days')::interval)`;
  }
}

function searchFilter(search: string): SQL | undefined {
  const term = search.trim();
  if (!term) return undefined;

  const pattern = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
  return or(ilike(knowledgeItems.title, pattern), ilike(knowledgeItems.slug, pattern));
}
