import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SAMPLE_FEATURE_CONTRACT, type SampleFeatureContract } from '@anomalia/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { SAMPLE_ITEM_REPOSITORY, type SampleItemRepository } from '../domain/sample-item.repository.js';

/**
 * This module's PUBLIC face for synchronous calls from other modules.
 *
 * Keep it narrow and keep it stable. Everything else in the module is free to
 * change; this is the part other teams compile against. Note it exposes a
 * derived number, not the entity — leaking `SampleItem` would let a caller
 * depend on our internals and re-create the coupling we are avoiding.
 *
 * Self-registration in `onModuleInit` is the last piece of the plug-and-play
 * story: the module inserts itself into the registry, core never mentions it,
 * and ContractVerifier fails the boot if this call is ever removed while
 * `provides` still advertises the contract.
 */
@Injectable()
export class SampleFeatureContractImpl implements SampleFeatureContract, OnModuleInit {
  private readonly logger = new Logger(SampleFeatureContractImpl.name);

  constructor(
    @Inject(SAMPLE_ITEM_REPOSITORY) private readonly repository: SampleItemRepository,
    private readonly registry: ContractRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(SAMPLE_FEATURE_CONTRACT, this, 'sample-feature');
  }

  async countItems(): Promise<number> {
    return this.repository.countAll();
  }
}
