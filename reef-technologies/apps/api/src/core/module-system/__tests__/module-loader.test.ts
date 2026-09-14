import { describe, expect, it } from 'vitest';
import { contractToken, type ModuleKey } from '@reef-technologies/contracts';
import { flagNameFor } from '@reef-technologies/config';
import { loadModules, ModuleLoadError } from '../module-loader.js';
import type { ReefTechnologiesModuleDefinition } from '../module.definition.js';

const TOKEN_A = contractToken<{ ping(): void }>('a.v1');

class FakeNestModule {}

const mod = (
  key: ModuleKey,
  extra: Partial<ReefTechnologiesModuleDefinition> = {},
): ReefTechnologiesModuleDefinition => ({
  key,
  version: '1.0.0',
  description: `${key} test module`,
  nestModule: FakeNestModule,
  ...extra,
});

/** All keys on, so each test switches off only what it cares about. */
const allOn = (overrides: Record<string, boolean> = {}) =>
  new Proxy({ ...overrides } as Record<string, boolean>, {
    get: (target, prop: string) => (prop in target ? target[prop] : true),
    has: () => true,
  });

describe('loadModules', () => {
  it('returns nest imports in dependency order', () => {
    const result = loadModules({
      registry: [
        mod('assessment', { dependsOn: ['immigration'], consumes: [TOKEN_A] }),
        mod('immigration', { provides: [TOKEN_A] }),
      ],
      flags: allOn(),
      nodeEnv: 'test',
    });
    expect(result.manifest.order).toEqual(['immigration', 'assessment']);
  });

  it('rejects a consumed contract with no enabled provider', () => {
    expect(() =>
      loadModules({
        registry: [mod('assessment', { consumes: [TOKEN_A] })],
        flags: allOn(),
        nodeEnv: 'test',
      }),
    ).toThrow(/no enabled module provides it/);
  });

  it('cascades disabling to dependents rather than crashing', () => {
    const result = loadModules({
      registry: [
        mod('immigration', { provides: [TOKEN_A] }),
        mod('assessment', { dependsOn: ['immigration'], consumes: [TOKEN_A] }),
      ],
      flags: allOn({ [flagNameFor('immigration')]: false }),
      nodeEnv: 'test',
    });
    expect(result.manifest.enabledKeys).not.toContain('assessment');
    const entry = result.manifest.entries.find((e) => e.key === 'assessment');
    expect(entry?.disabledReason).toMatch(/dependency "immigration" is disabled/);
  });

  it('detects dependency cycles', () => {
    expect(() =>
      loadModules({
        registry: [
          mod('assessment', { dependsOn: ['knowledge'] }),
          mod('knowledge', { dependsOn: ['assessment'] }),
        ],
        flags: allOn(),
        nodeEnv: 'test',
      }),
    ).toThrow(ModuleLoadError);
  });

  it('rejects two modules providing the same contract', () => {
    expect(() =>
      loadModules({
        registry: [mod('knowledge', { provides: [TOKEN_A] }), mod('immigration', { provides: [TOKEN_A] })],
        flags: allOn(),
        nodeEnv: 'test',
      }),
    ).toThrow(/provided by both/);
  });

  it('rejects event names that are not in the catalog', () => {
    expect(() =>
      loadModules({
        registry: [mod('knowledge', { publishes: ['knowledge.item.exploded' as never] })],
        flags: allOn(),
        nodeEnv: 'test',
      }),
    ).toThrow(/unknown event/);
  });

  it('keeps experimental modules out of production', () => {
    const result = loadModules({
      registry: [mod('billing', { stability: 'experimental' })],
      flags: allOn(),
      nodeEnv: 'production',
    });
    expect(result.manifest.enabledKeys).toEqual([]);
  });

  it('collects config schemas from enabled modules only', () => {
    const result = loadModules({
      registry: [mod('billing'), mod('analytics')],
      flags: allOn({ [flagNameFor('analytics')]: false }),
      nodeEnv: 'test',
    });
    expect(result.manifest.enabledKeys).toEqual(['billing']);
  });
});
