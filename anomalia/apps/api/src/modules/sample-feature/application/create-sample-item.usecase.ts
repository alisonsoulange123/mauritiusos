import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { SampleItem } from '../domain/sample-item.entity.js';
import { SAMPLE_ITEM_REPOSITORY, type SampleItemRepository } from '../domain/sample-item.repository.js';

export interface CreateSampleItemInput {
  title: string;
  notes?: string;
  ownerId: string;
}

/**
 * A USE CASE: one business operation, one public method.
 *
 * Use cases orchestrate; they hold no rules of their own. The title rule lives
 * in the entity, persistence lives behind the port, notification lives on the
 * bus. What this class contributes is the *sequence*, and keeping that in one
 * named place is why "create an item" means the same thing whether it was
 * triggered by HTTP, a CLI or an event handler.
 *
 * Naming follows the Engineering Standards §11: <Verb><Noun>UseCase.
 */
@Injectable()
export class CreateSampleItemUseCase {
  constructor(
    @Inject(SAMPLE_ITEM_REPOSITORY) private readonly repository: SampleItemRepository,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly audit: AuditService,
  ) {}

  async execute(input: CreateSampleItemInput): Promise<SampleItem> {
    const item = SampleItem.create({
      id: randomUUID(),
      tenantId: this.tenantContext.requireTenantId(),
      ownerId: input.ownerId,
      title: input.title,
      notes: input.notes ?? null,
    });

    await this.repository.save(item);

    await this.audit.record({
      action: 'sample_item.created',
      resourceType: 'sample_item',
      resourceId: item.id,
    });

    /**
     * Announce, do not command.
     *
     * We publish a fact ("an item was created") rather than calling whatever
     * needs to react. Analytics, notifications and the AI worker can all
     * subscribe later without this file ever being reopened — and if nothing
     * subscribes, nothing breaks. That is the whole low-coupling bargain.
     *
     * Published AFTER the write commits: a consumer must never observe an
     * event for a row it cannot yet read.
     */
    await this.events.publish('sample-feature.item.created', {
      itemId: item.id,
      title: item.title,
      ownerId: item.ownerId,
    });

    return item;
  }
}
