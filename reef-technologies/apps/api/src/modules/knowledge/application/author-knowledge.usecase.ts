import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { knowledgeItems, knowledgeSources } from '../infrastructure/knowledge.schema.js';
import { isEditable, type KnowledgeStatus } from '../domain/publication-policy.js';
import { slugify } from '../domain/slug.js';

export interface CreateKnowledgeInput {
  title: string;
  type: 'RULE' | 'GUIDE' | 'LOCATION' | 'PROCESS' | 'FAQ' | 'DOCUMENT';
  category: string;
  content: string;
  locale: string;
  slug?: string;
  sourceId?: string;
  confidenceScore?: number;
}

export type UpdateKnowledgeInput = Partial<Omit<CreateKnowledgeInput, 'locale'>>;

/**
 * Writing knowledge.
 *
 * Items are always created as drafts — there is no "create published" path, so
 * publication is always a separate, audited decision rather than a field
 * somebody sets on the way in.
 */
@Injectable()
export class AuthorKnowledgeUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateKnowledgeInput): Promise<{ id: string; slug: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const slug = input.slug?.trim() || slugify(input.title);

    if (!slug) {
      // A title of nothing but punctuation or diacritics folds to an empty
      // string. Better to say so than to write a row keyed on ''.
      throw new DomainError(
        'KNOWLEDGE_SLUG_UNRESOLVABLE',
        'That title does not produce a usable slug. Supply one explicitly.',
        422,
      );
    }

    await this.assertSourceExists(tenantId, input.sourceId);
    await this.assertSlugFree(tenantId, slug, input.locale);

    const id = randomUUID();
    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx.insert(knowledgeItems).values({
        id,
        tenantId,
        title: input.title,
        slug,
        type: input.type,
        category: input.category,
        content: input.content,
        locale: input.locale,
        status: 'draft',
        confidenceScore: input.confidenceScore ?? 80,
        sourceId: input.sourceId ?? null,
      });
    });

    await this.audit.record({
      action: 'knowledge.item.created',
      resourceType: 'knowledge_item',
      resourceId: id,
      metadata: { slug, locale: input.locale, type: input.type },
    });

    return { id, slug };
  }

  async update(id: string, input: UpdateKnowledgeInput): Promise<void> {
    const tenantId = this.tenantContext.requireTenantId();
    const existing = await this.load(tenantId, id);

    /*
     * Published text is frozen, and not out of procedural fussiness: the item
     * carries a verification date, and rewriting the words behind that date
     * turns it into a false claim — "verified on the 3rd" describing a
     * paragraph nobody verified. The remedy is one named step, so the refusal
     * names it.
     */
    if (!isEditable(existing.status as KnowledgeStatus)) {
      throw new DomainError(
        'KNOWLEDGE_ITEM_PUBLISHED',
        'A published item cannot be edited. Move it back to review first.',
        409,
      );
    }

    const slug = input.slug?.trim() || (input.title ? slugify(input.title) : existing.slug);
    if (slug !== existing.slug) await this.assertSlugFree(tenantId, slug, existing.locale);
    await this.assertSourceExists(tenantId, input.sourceId);

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(knowledgeItems)
        .set({
          ...(input.title ? { title: input.title } : {}),
          ...(input.type ? { type: input.type } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.content !== undefined ? { content: input.content } : {}),
          ...(input.confidenceScore !== undefined
            ? { confidenceScore: input.confidenceScore }
            : {}),
          ...(input.sourceId ? { sourceId: input.sourceId } : {}),
          slug,
        })
        .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)));
    });

    await this.audit.record({
      action: 'knowledge.item.updated',
      resourceType: 'knowledge_item',
      resourceId: id,
      metadata: { slug, fields: Object.keys(input) },
    });
  }

  /**
   * Stamps the verification date.
   *
   * Separate from `update` because it is a different act: one says what the
   * platform asserts, the other says somebody checked that it is still true.
   * Conflating them is how a verification date ends up being bumped by a typo
   * fix.
   */
  async verify(id: string, confidenceScore?: number): Promise<{ verifiedAt: Date }> {
    const tenantId = this.tenantContext.requireTenantId();
    await this.load(tenantId, id);

    const verifiedAt = new Date();
    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(knowledgeItems)
        .set({
          verifiedAt,
          ...(confidenceScore !== undefined ? { confidenceScore } : {}),
        })
        .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)));
    });

    await this.audit.record({
      action: 'knowledge.item.verified',
      resourceType: 'knowledge_item',
      resourceId: id,
      ...(confidenceScore !== undefined ? { metadata: { confidenceScore } } : {}),
    });

    return { verifiedAt };
  }

  private async load(tenantId: string, id: string) {
    const rows = await this.database.db
      .select()
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)))
      .limit(1);

    const item = rows[0];
    if (!item) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such knowledge item.', 404);
    return item;
  }

  /**
   * Checked before the insert rather than caught afterwards.
   *
   * The table has a unique index on (tenant, slug, locale), so the database
   * would refuse it either way — but as a driver error with no useful message.
   * An editor renaming an article deserves to be told which slug collided.
   */
  private async assertSlugFree(tenantId: string, slug: string, locale: string): Promise<void> {
    const clash = await this.database.db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(
        and(
          eq(knowledgeItems.tenantId, tenantId),
          eq(knowledgeItems.slug, slug),
          eq(knowledgeItems.locale, locale),
        ),
      )
      .limit(1);

    if (clash.length) {
      throw new DomainError(
        'KNOWLEDGE_SLUG_TAKEN',
        `Another ${locale} item already uses the slug "${slug}".`,
        409,
      );
    }
  }

  /** A source id from another tenant, or none at all, must not be stored. */
  private async assertSourceExists(tenantId: string, sourceId?: string): Promise<void> {
    if (!sourceId) return;

    const rows = await this.database.db
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.tenantId, tenantId), eq(knowledgeSources.id, sourceId)))
      .limit(1);

    if (!rows.length) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such source.', 404);
    }
  }
}
