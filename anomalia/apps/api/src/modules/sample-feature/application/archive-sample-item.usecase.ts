import { Inject, Injectable } from '@nestjs/common';
import { DomainError, ERROR_CODES, NotFoundError } from '@anomalia/contracts';
import { AuditService } from '../../../core/audit/audit.service.js';
import { SAMPLE_ITEM_REPOSITORY, type SampleItemRepository } from '../domain/sample-item.repository.js';

@Injectable()
export class ArchiveSampleItemUseCase {
  constructor(
    @Inject(SAMPLE_ITEM_REPOSITORY) private readonly repository: SampleItemRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(itemId: string, actorId: string, isAdmin: boolean): Promise<void> {
    const item = await this.repository.findById(itemId);
    if (!item) throw new NotFoundError('sample_item', itemId);

    // Authorization that depends on the record is ABAC and belongs here, not
    // in a guard: a guard cannot know who owns row X without loading it.
    if (!item.isOwnedBy(actorId) && !isAdmin) {
      await this.audit.record({
        action: 'sample_item.archive',
        resourceType: 'sample_item',
        resourceId: itemId,
        result: 'denied',
      });
      throw new DomainError(ERROR_CODES.FORBIDDEN, 'You can only archive your own items.', 403);
    }

    item.archive();
    await this.repository.save(item);
    await this.audit.record({ action: 'sample_item.archived', resourceType: 'sample_item', resourceId: itemId });
  }
}
