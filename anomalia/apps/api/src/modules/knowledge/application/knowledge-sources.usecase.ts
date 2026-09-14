import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { knowledgeSources } from '../infrastructure/knowledge.schema.js';

export interface CreateSourceInput {
  name: string;
  sourceType: 'government' | 'partner' | 'editorial' | 'community';
  authorityLevel: 'official' | 'partner' | 'editorial' | 'community';
  url?: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  sourceType: string;
  authorityLevel: string;
  url: string | null;
  verifiedAt: Date | null;
}

/**
 * Sources exist so publication can require one.
 *
 * Without a way to create them the provenance rule would be unsatisfiable and
 * nothing could ever be published — the same bootstrap trap the role endpoint
 * hit when no admin existed.
 */
@Injectable()
export class KnowledgeSourcesUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<SourceSummary[]> {
    const tenantId = this.tenantContext.requireTenantId();

    return this.database.db
      .select({
        id: knowledgeSources.id,
        name: knowledgeSources.name,
        sourceType: knowledgeSources.sourceType,
        authorityLevel: knowledgeSources.authorityLevel,
        url: knowledgeSources.url,
        verifiedAt: knowledgeSources.verifiedAt,
      })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.tenantId, tenantId))
      .orderBy(asc(knowledgeSources.name));
  }

  async create(input: CreateSourceInput): Promise<{ id: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const id = randomUUID();

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx.insert(knowledgeSources).values({
        id,
        tenantId,
        name: input.name,
        sourceType: input.sourceType,
        authorityLevel: input.authorityLevel,
        url: input.url ?? null,
        // Recording a source IS checking it — somebody just typed in where it
        // lives. The date is what the item's own freshness is later measured
        // against, so it starts now rather than null.
        verifiedAt: new Date(),
      });
    });

    await this.audit.record({
      action: 'knowledge.source.created',
      resourceType: 'knowledge_source',
      resourceId: id,
      metadata: { name: input.name, authorityLevel: input.authorityLevel },
    });

    return { id };
  }
}
