import type { Type } from '@nestjs/common';
import type { z } from 'zod';
import type { ContractToken, EventName, ModuleKey } from '@anomalia/contracts';

/**
 * A module's DECLARATION of itself.
 *
 * This is the whole plug-in contract. A module states what it is, what it
 * needs, and what it offers — and the loader verifies all of it at boot. The
 * value is that coupling becomes *declared* rather than discovered: you can
 * read a module's blast radius off its definition without reading its code,
 * and the loader refuses to start a configuration that does not hold together.
 */
export interface AnomaliaModuleDefinition {
  /** Stable identifier. Also the directory name and the flag suffix. */
  key: ModuleKey;

  /** Bumped on breaking changes to this module's public contracts. */
  version: `${number}.${number}.${number}`;

  /** One line, shown in the boot log and the capabilities endpoint. */
  description: string;

  /** The NestJS module to import. The only framework coupling in here. */
  nestModule: Type<unknown>;

  /**
   * Env vars this module needs, merged into the validated config at boot.
   * A disabled module's variables are never required.
   */
  configSchema?: z.ZodObject<z.ZodRawShape>;

  /**
   * Contracts this module IMPLEMENTS. The loader asserts each one is actually
   * registered once the app has booted — a module that forgets to register a
   * contract it advertised fails fast instead of at the first caller.
   */
  provides?: ReadonlyArray<ContractToken<unknown>>;

  /**
   * Contracts this module CALLS. The loader verifies some enabled module
   * provides each of them, so disabling a provider surfaces immediately at
   * boot rather than as a runtime 500 next Tuesday.
   */
  consumes?: ReadonlyArray<ContractToken<unknown>>;

  /** Events emitted. Documentation the loader cross-checks against the catalog. */
  publishes?: readonly EventName[];

  /** Events consumed. Used to render the platform's event topology. */
  subscribes?: readonly EventName[];

  /**
   * Hard module dependencies — use sparingly. Event subscriptions do NOT
   * belong here: a subscriber must tolerate its publisher being absent.
   * Only a `consumes` relationship justifies an entry.
   */
  dependsOn?: readonly ModuleKey[];

  /** Governs whether the module may be enabled in production. */
  stability?: 'experimental' | 'beta' | 'stable';
}

/** What the loader produces: the boot-time truth about the running platform. */
export interface ModuleManifestEntry {
  key: ModuleKey;
  version: string;
  description: string;
  stability: 'experimental' | 'beta' | 'stable';
  enabled: boolean;
  /** Why it is off: flag, unmet dependency, or stability gate. */
  disabledReason?: string;
  provides: string[];
  consumes: string[];
  publishes: string[];
  subscribes: string[];
}

export interface ModuleManifest {
  /** Load order after topological sort. */
  order: ModuleKey[];
  entries: ModuleManifestEntry[];
  enabledKeys: ModuleKey[];
}

export const MODULE_MANIFEST = Symbol.for('anomalia.core.ModuleManifest');

/**
 * Identity helper that exists purely for type inference and grep-ability.
 * Every module's `index.ts` ends with `export default defineModule({...})`.
 */
export const defineModule = (definition: AnomaliaModuleDefinition): AnomaliaModuleDefinition =>
  definition;
