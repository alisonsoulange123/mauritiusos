import type { Type } from '@nestjs/common';
import { isEventName, type ModuleKey } from '@anomalia/contracts';
import { flagNameFor, isModuleEnabled, type FlagSet } from '@anomalia/config';
import type { AnomaliaModuleDefinition, ModuleManifest, ModuleManifestEntry } from './module.definition.js';

export class ModuleLoadError extends Error {
  constructor(problems: string[]) {
    super(
      `Module graph is invalid — refusing to start.\n${problems.map((p) => `  ✗ ${p}`).join('\n')}\n` +
        'Fix src/modules/registry.ts or the FEATURE_* flags.',
    );
    this.name = 'ModuleLoadError';
  }
}

export interface LoadModulesInput {
  registry: readonly AnomaliaModuleDefinition[];
  flags: FlagSet;
  nodeEnv: string;
}

export interface LoadModulesResult {
  /** Pass straight into `@Module({ imports })`. */
  imports: Array<Type<unknown>>;
  manifest: ModuleManifest;
  /** Config schemas of enabled modules, for `loadServerEnv`. */
  configSchemas: Array<{ key: string; schema: NonNullable<AnomaliaModuleDefinition['configSchema']> }>;
}

/**
 * Resolves the registry into a bootable module graph, or refuses to boot.
 *
 * Seven checks, each one a class of 3am incident this prevents:
 *   1. duplicate keys        — two modules silently fighting over a route
 *   2. unknown event names   — a typo'd subscription that never fires
 *   3. flag gating           — modules off by configuration
 *   4. experimental gate     — half-built code reaching production
 *   5. dependency presence   — `consumes` with nothing providing it
 *   6. transitive disabling  — a module whose dependency is off
 *   7. cycle detection       — A needs B needs A, i.e. a broken boundary
 */
/**
 * Resolves the registry into a bootable module graph, or refuses to boot.
 *
 * Each check below is a class of 3am incident this prevents. They are separate
 * functions rather than one pass so each failure mode can be read, tested and
 * changed on its own.
 */
export function loadModules({ registry, flags, nodeEnv }: LoadModulesInput): LoadModulesResult {
  const problems: string[] = [];

  const byKey = indexRegistry(registry, problems);
  validateEventNames(registry, problems);

  const disabledReasons = resolveDisabled({ registry, byKey, flags, nodeEnv, problems });
  const enabled = registry.filter((definition) => !disabledReasons.has(definition.key));
  const enabledKeys = new Set(enabled.map((definition) => definition.key));

  validateContracts(enabled, problems);
  const order = topologicalOrder(enabled, byKey, enabledKeys, problems);

  // Report everything at once: fixing one problem only to discover the next on
  // the following boot is a miserable way to configure a deployment.
  if (problems.length) throw new ModuleLoadError(problems);

  const orderedDefinitions = order
    .map((key) => byKey.get(key))
    .filter((definition): definition is AnomaliaModuleDefinition => definition !== undefined);

  return {
    imports: orderedDefinitions.map((definition) => definition.nestModule),
    manifest: {
      order,
      entries: buildManifest(registry, disabledReasons),
      enabledKeys: [...enabledKeys],
    },
    configSchemas: orderedDefinitions
      .filter((definition) => definition.configSchema)
      .map((definition) => ({ key: definition.key, schema: definition.configSchema! })),
  };
}

/** Check 1: duplicate keys — two modules silently fighting over a route. */
function indexRegistry(
  registry: readonly AnomaliaModuleDefinition[],
  problems: string[],
): Map<ModuleKey, AnomaliaModuleDefinition> {
  const byKey = new Map<ModuleKey, AnomaliaModuleDefinition>();
  for (const definition of registry) {
    if (byKey.has(definition.key)) {
      problems.push(`duplicate module key "${definition.key}" in the registry`);
      continue;
    }
    byKey.set(definition.key, definition);
  }
  return byKey;
}

/** Check 2: a typo'd event name is a subscription that never fires. */
function validateEventNames(
  registry: readonly AnomaliaModuleDefinition[],
  problems: string[],
): void {
  for (const definition of registry) {
    for (const name of [...(definition.publishes ?? []), ...(definition.subscribes ?? [])]) {
      if (!isEventName(name)) {
        problems.push(
          `module "${definition.key}" references unknown event "${name}" — add it to the catalog in @anomalia/contracts`,
        );
      }
    }
  }
}

interface ResolveDisabledInput {
  registry: readonly AnomaliaModuleDefinition[];
  byKey: Map<ModuleKey, AnomaliaModuleDefinition>;
  flags: FlagSet;
  nodeEnv: string;
  problems: string[];
}

/**
 * Checks 3, 4 and 6: flag gating, the production stability gate, and
 * transitive disabling.
 *
 * The cascade is iterated to a fixed point so a chain A -> B -> C collapses
 * fully: disabling C must disable B and A, not just B.
 */
function resolveDisabled({
  registry,
  byKey,
  flags,
  nodeEnv,
  problems,
}: ResolveDisabledInput): Map<ModuleKey, string> {
  const disabled = applyGates(registry, flags, nodeEnv);
  cascadeDisabled(registry, byKey, disabled, problems);
  return disabled;
}

/** Checks 3 and 4: the feature flag and the production stability gate. */
function applyGates(
  registry: readonly AnomaliaModuleDefinition[],
  flags: FlagSet,
  nodeEnv: string,
): Map<ModuleKey, string> {
  const disabled = new Map<ModuleKey, string>();
  for (const definition of registry) {
    if (!isModuleEnabled(flags, definition.key)) {
      disabled.set(definition.key, `${flagNameFor(definition.key)} is not enabled`);
      continue;
    }
    if ((definition.stability ?? 'stable') === 'experimental' && nodeEnv === 'production') {
      disabled.set(definition.key, 'experimental modules cannot run in production');
    }
  }
  return disabled;
}

/**
 * Check 6: a module whose dependency is off is itself off.
 *
 * Iterated to a fixed point so a chain A -> B -> C collapses fully rather than
 * one link per call.
 */
function cascadeDisabled(
  registry: readonly AnomaliaModuleDefinition[],
  byKey: Map<ModuleKey, AnomaliaModuleDefinition>,
  disabled: Map<ModuleKey, string>,
  problems: string[],
): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const definition of registry) {
      if (disabled.has(definition.key)) continue;
      for (const dependency of definition.dependsOn ?? []) {
        if (!byKey.has(dependency)) {
          problems.push(
            `module "${definition.key}" depends on "${dependency}", which is not in the registry`,
          );
          continue;
        }
        if (disabled.has(dependency)) {
          disabled.set(definition.key, `dependency "${dependency}" is disabled`);
          changed = true;
          break;
        }
      }
    }
  }
}

/** Check 5: every consumed contract has exactly one enabled provider. */
function validateContracts(
  enabled: readonly AnomaliaModuleDefinition[],
  problems: string[],
): void {
  const providers = new Map<string, ModuleKey>();

  for (const definition of enabled) {
    for (const token of definition.provides ?? []) {
      const existing = providers.get(token.key);
      if (existing) {
        problems.push(
          `contract "${token.key}" is provided by both "${existing}" and "${definition.key}"`,
        );
        continue;
      }
      providers.set(token.key, definition.key);
    }
  }

  for (const definition of enabled) {
    for (const token of definition.consumes ?? []) {
      if (!providers.has(token.key)) {
        problems.push(
          `module "${definition.key}" consumes contract "${token.key}" but no enabled module provides it`,
        );
      }
    }
  }
}

/** Check 7: cycle detection, and the load order the app module uses. */
function topologicalOrder(
  enabled: readonly AnomaliaModuleDefinition[],
  byKey: Map<ModuleKey, AnomaliaModuleDefinition>,
  enabledKeys: Set<ModuleKey>,
  problems: string[],
): ModuleKey[] {
  const order: ModuleKey[] = [];
  const state = new Map<ModuleKey, 'visiting' | 'done'>();

  const visit = (key: ModuleKey, path: ModuleKey[]): void => {
    const current = state.get(key);
    if (current === 'done') return;
    if (current === 'visiting') {
      problems.push(`dependency cycle: ${[...path, key].join(' -> ')}`);
      return;
    }
    state.set(key, 'visiting');
    for (const dependency of byKey.get(key)?.dependsOn ?? []) {
      if (enabledKeys.has(dependency)) visit(dependency, [...path, key]);
    }
    state.set(key, 'done');
    order.push(key);
  };

  for (const definition of enabled) visit(definition.key, []);
  return order;
}

/** The boot-time truth, including why each disabled module is off. */
function buildManifest(
  registry: readonly AnomaliaModuleDefinition[],
  disabledReasons: Map<ModuleKey, string>,
): ModuleManifestEntry[] {
  return registry.map((definition) => {
    const reason = disabledReasons.get(definition.key);
    return {
      key: definition.key,
      version: definition.version,
      description: definition.description,
      stability: definition.stability ?? 'stable',
      enabled: reason === undefined,
      ...(reason ? { disabledReason: reason } : {}),
      provides: (definition.provides ?? []).map((token) => token.key),
      consumes: (definition.consumes ?? []).map((token) => token.key),
      publishes: [...(definition.publishes ?? [])],
      subscribes: [...(definition.subscribes ?? [])],
    };
  });
}

/** Human-readable boot summary. Printed once, at startup. */
export function describeManifest(manifest: ModuleManifest): string {
  const lines = manifest.entries.map((entry) => {
    const mark = entry.enabled ? '●' : '○';
    const flag = entry.stability === 'stable' ? '' : ` [${entry.stability}]`;
    const why = entry.enabled ? '' : ` — ${entry.disabledReason}`;
    return `  ${mark} ${entry.key.padEnd(16)} v${entry.version}${flag}${why}`;
  });
  const enabledCount = manifest.entries.filter((entry) => entry.enabled).length;
  return [
    `modules (${enabledCount}/${manifest.entries.length} enabled), load order: ${manifest.order.join(' → ')}`,
    ...lines,
  ].join('\n');
}
