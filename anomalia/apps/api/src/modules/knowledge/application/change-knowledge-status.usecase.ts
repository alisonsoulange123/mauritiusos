import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { knowledgeItems } from '../infrastructure/knowledge.schema.js';
import {
  refusePublication,
  refuseTransition,
  type KnowledgeStatus,
  type PublicationRefusal,
  type TransitionRefusal,
} from '../domain/publication-policy.js';
import type { KnowledgeEnv } from './knowledge-env.js';

export interface ChangeStatusResult {
  id: string;
  from: KnowledgeStatus;
  to: KnowledgeStatus;
}

/**
 * Moving an item through the editorial lifecycle.
 *
 * Publication is the interesting direction. It is the moment the platform
 * starts asserting something — the concierge will cite it as verified — so it
 * is the moment the provenance and freshness rules are checked, and the moment
 * `knowledge.item.published` finally goes out.
 *
 * That event has been declared in the module manifest since the beginning and
 * published by nothing, while `ai-concierge` sat subscribed to it waiting for
 * a message that never came. Same shape of gap as `identity.role.changed`: the
 * contract was honest about intent and silent in practice.
 */
@Injectable()
export class ChangeKnowledgeStatusUseCase {
  private readonly logger = new Logger(ChangeKnowledgeStatusUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async execute(id: string, to: KnowledgeStatus): Promise<ChangeStatusResult> {
    const tenantId = this.tenantContext.requireTenantId();

    const rows = await this.database.db
      .select()
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)))
      .limit(1);

    const item = rows[0];
    if (!item) throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such knowledge item.', 404);

    const from = item.status as KnowledgeStatus;

    const invalid = refuseTransition(from, to);
    if (invalid) await this.refuse(id, from, to, invalid);

    if (to === 'published') {
      const refusal = refusePublication(
        {
          sourceId: item.sourceId,
          verifiedAt: item.verifiedAt,
          content: item.content,
          confidenceScore: item.confidenceScore,
        },
        this.config.module<KnowledgeEnv>().KNOWLEDGE_MIN_CONFIDENCE,
      );
      if (refusal) await this.refuse(id, from, to, refusal);
    }

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(knowledgeItems)
        .set({ status: to })
        .where(and(eq(knowledgeItems.tenantId, tenantId), eq(knowledgeItems.id, id)));
    });

    await this.audit.record({
      action: 'knowledge.item.status_changed',
      resourceType: 'knowledge_item',
      resourceId: id,
      metadata: { from, to, slug: item.slug },
    });

    if (to === 'published') {
      await this.events.publish('knowledge.item.published', {
        knowledgeId: id,
        slug: item.slug,
        category: item.category,
        // The Python worker embeds on this signal. True on every publication,
        // including a re-publication after edits: the stored vectors describe
        // the text as it was, and stale vectors are how a retrieval system
        // starts citing paragraphs that no longer exist.
        requiresEmbedding: true,
      });
    }

    this.logger.log(`knowledge ${item.slug}: ${from} -> ${to}`);
    return { id, from, to };
  }

  /** Records the refusal before raising it — a blocked publication is a signal. */
  private async refuse(
    id: string,
    from: KnowledgeStatus,
    to: KnowledgeStatus,
    reason: PublicationRefusal | TransitionRefusal,
  ): Promise<never> {
    await this.audit.record({
      action: 'knowledge.item.status_denied',
      resourceType: 'knowledge_item',
      resourceId: id,
      result: 'denied',
      metadata: { from, to, reason },
    });

    throw new DomainError('KNOWLEDGE_TRANSITION_REFUSED', REFUSAL_MESSAGES[reason], 409);
  }
}

const REFUSAL_MESSAGES: Record<PublicationRefusal | TransitionRefusal, string> = {
  unchanged: 'That item is already in this state.',
  'invalid-transition': 'An item cannot move directly between those states.',
  'no-source': 'Publication needs a source. Every fact this platform states must be traceable.',
  'never-verified':
    'This item has never been verified. Verify it before publishing, or it would be served as authoritative indefinitely.',
  'empty-content': 'There is nothing to publish.',
  'below-confidence-floor':
    'Its confidence is below the search floor, so publishing it would make it live and invisible at once.',
};
