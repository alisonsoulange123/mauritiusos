import { Module } from '@nestjs/common';
import { SampleFeatureController } from './interface/http/sample-feature.controller.js';
import { CreateSampleItemUseCase } from './application/create-sample-item.usecase.js';
import { ListSampleItemsUseCase } from './application/list-sample-items.usecase.js';
import { ArchiveSampleItemUseCase } from './application/archive-sample-item.usecase.js';
import { SampleFeatureContractImpl } from './application/sample-feature.contract-impl.js';
import { SampleFeatureSubscribers } from './application/sample-feature.subscribers.js';
import { SAMPLE_ITEM_REPOSITORY } from './domain/sample-item.repository.js';
import { DrizzleSampleItemRepository } from './infrastructure/drizzle-sample-item.repository.js';

/**
 * The Nest wiring. Note the `imports` array: EMPTY.
 *
 * Everything this module needs from the platform — database, event bus,
 * tenant context, audit, config — comes from `@Global()` core modules, so a
 * module never imports another module and there is no import graph to
 * maintain. That absence is the point.
 *
 * `exports` is empty too: nothing here is for other modules to inject. They
 * reach us through the contract registry or the event bus, or not at all.
 */
@Module({
  controllers: [SampleFeatureController],
  providers: [
    CreateSampleItemUseCase,
    ListSampleItemsUseCase,
    ArchiveSampleItemUseCase,
    SampleFeatureContractImpl,
    SampleFeatureSubscribers,
    // Port -> adapter. Swap this one line for an in-memory implementation and
    // the whole module runs with no database.
    { provide: SAMPLE_ITEM_REPOSITORY, useClass: DrizzleSampleItemRepository },
  ],
})
export class SampleFeatureModule {}
