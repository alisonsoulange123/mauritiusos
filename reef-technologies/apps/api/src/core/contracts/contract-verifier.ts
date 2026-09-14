import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { MODULE_MANIFEST, type ModuleManifest } from '../module-system/module.definition.js';
import { ContractRegistry } from './contract-registry.js';

/**
 * Verifies, once the whole graph is up, that every module actually registered
 * the contracts it advertised in its definition.
 *
 * Without this, a module could declare `provides: [IMMIGRATION_CONTRACT]` and
 * forget the `register()` call. The loader's static check would pass and the
 * first real caller would get a 503 in production. Here it is a boot failure.
 */
@Injectable()
export class ContractVerifier implements OnApplicationBootstrap {
  private readonly logger = new Logger(ContractVerifier.name);

  constructor(
    private readonly registry: ContractRegistry,
    @Inject(MODULE_MANIFEST) private readonly manifest: ModuleManifest,
  ) {}

  onApplicationBootstrap(): void {
    const registered = new Set(this.registry.describe().map((entry) => entry.contract));
    const missing: string[] = [];

    for (const entry of this.manifest.entries) {
      if (!entry.enabled) continue;
      for (const contract of entry.provides) {
        if (!registered.has(contract)) {
          missing.push(`module "${entry.key}" declares provides:["${contract}"] but never registered it`);
        }
      }
    }

    if (missing.length) {
      throw new Error(
        `Contract verification failed — refusing to serve traffic.\n${missing.map((m) => `  ✗ ${m}`).join('\n')}\n` +
          'Call contractRegistry.register(TOKEN, impl, MODULE_KEY) in the module\'s onModuleInit.',
      );
    }

    this.logger.log(`contract verification passed (${registered.size} contract(s) live)`);
  }
}
