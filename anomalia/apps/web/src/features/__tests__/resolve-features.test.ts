import { describe, expect, it } from 'vitest';
import { navigationFor, resolveFeatures } from '../resolve-features';
import type { Capabilities } from '@/shared/capabilities/capabilities';

const capabilities = (enabled: string[]): Capabilities => ({
  app: 'anomalia-api',
  environment: 'test',
  modules: [],
  enabled,
  // Reachable by definition in these fixtures; the degraded path is exercised
  // separately, because "read and empty" and "unreadable" are not the same.
  degraded: false,
});

const ALL = ['assessment', 'knowledge', 'immigration', 'ai-concierge', 'identity'];

describe('resolveFeatures', () => {
  it('hides a feature whose backend module is disabled', () => {
    const resolved = resolveFeatures({
      capabilities: capabilities(['identity', 'knowledge']),
      roles: ['client'],
      authenticated: true,
    });
    const concierge = resolved.find((entry) => entry.definition.key === 'ai-concierge');
    expect(concierge?.visible).toBe(false);
    expect(concierge?.reason).toBe('module-disabled');
  });

  it('shows public features to anonymous visitors', () => {
    const resolved = resolveFeatures({
      capabilities: capabilities(ALL),
      roles: [],
      authenticated: false,
    });
    const assessment = resolved.find((entry) => entry.definition.key === 'assessment');
    expect(assessment?.visible).toBe(true);
  });

  it('hides authenticated-only features from anonymous visitors', () => {
    const resolved = resolveFeatures({
      capabilities: capabilities(ALL),
      roles: [],
      authenticated: false,
    });
    const concierge = resolved.find((entry) => entry.definition.key === 'ai-concierge');
    expect(concierge?.visible).toBe(false);
    expect(concierge?.reason).toBe('requires-auth');
  });

  it('orders navigation by the declared order', () => {
    const nav = navigationFor(
      resolveFeatures({ capabilities: capabilities(ALL), roles: ['client'], authenticated: true }),
    );
    const orders = nav.map((item) => item.key);
    expect(orders).toEqual([...orders].sort((a, b) => orders.indexOf(a) - orders.indexOf(b)));
    expect(nav.length).toBeGreaterThan(0);
  });
});
