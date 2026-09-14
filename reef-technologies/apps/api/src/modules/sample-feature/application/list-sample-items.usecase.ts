import { Inject, Injectable } from '@nestjs/common';
import type { Page, PageQuery } from '@reef-technologies/contracts';
import { ConfigService } from '../../../core/config/config.service.js';
import { SAMPLE_ITEM_REPOSITORY, type SampleItemRepository } from '../domain/sample-item.repository.js';
import type { SampleItem } from '../domain/sample-item.entity.js';
import type { SampleFeatureEnv } from '../sample-feature.config.js';

@Injectable()
export class ListSampleItemsUseCase {
  constructor(
    @Inject(SAMPLE_ITEM_REPOSITORY) private readonly repository: SampleItemRepository,
    private readonly config: ConfigService,
  ) {}

  async execute(query: Partial<PageQuery>): Promise<Page<SampleItem>> {
    // The module's own validated env, not a magic number and not a global.
    const { SAMPLE_FEATURE_PAGE_SIZE } = this.config.module<SampleFeatureEnv>();
    return this.repository.list({
      limit: query.limit ?? SAMPLE_FEATURE_PAGE_SIZE,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
  }
}
