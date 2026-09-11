import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadServerEnv } from '../server';
import { flagNameFor, isModuleEnabled, loadFlags } from '../flags';

const valid = {
  DATABASE_URL: 'postgres://anomalia:pw@localhost:5432/anomalia',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'a'.repeat(48),
  EVENT_BUS_DRIVER: 'memory',
};

describe('loadServerEnv', () => {
  it('applies defaults and coerces types', () => {
    const { core } = loadServerEnv({ source: valid });
    expect(core.PORT).toBe(4000);
    expect(core.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(core.TENANT_STRICT).toBe(true);
  });

  it('refuses to start on a missing secret', () => {
    const { JWT_SECRET, ...withoutSecret } = valid;
    void JWT_SECRET;
    expect(() => loadServerEnv({ source: withoutSecret })).toThrow(/JWT_SECRET/);
  });

  it('rejects placeholder secrets', () => {
    expect(() => loadServerEnv({ source: { ...valid, JWT_SECRET: 'changeme' } })).toThrow();
  });

  it('enforces production invariants', () => {
    expect(() =>
      loadServerEnv({ source: { ...valid, NODE_ENV: 'production', EVENT_BUS_DRIVER: 'memory' } }),
    ).toThrow(/in-memory bus/);
  });

  it('merges module-contributed schemas', () => {
    const { modules } = loadServerEnv<{ SAMPLE_FEATURE_PAGE_SIZE: number }>({
      source: { ...valid, SAMPLE_FEATURE_PAGE_SIZE: '50' },
      moduleSchemas: [
        { key: 'sample-feature', schema: z.object({ SAMPLE_FEATURE_PAGE_SIZE: z.coerce.number() }) },
      ],
    });
    expect(modules.SAMPLE_FEATURE_PAGE_SIZE).toBe(50);
  });

  it('names the offending module when its config is invalid', () => {
    expect(() =>
      loadServerEnv({
        source: valid,
        moduleSchemas: [{ key: 'billing', schema: z.object({ STRIPE_KEY: z.string() }) }],
      }),
    ).toThrow(/module: billing/);
  });

  it('redacts secrets for logging', () => {
    const { redacted } = loadServerEnv({ source: valid });
    expect(redacted.JWT_SECRET).toMatch(/redacted/);
    expect(redacted.PORT).toBe(4000);
  });
});

describe('flags', () => {
  it('derives flag names from module keys', () => {
    expect(flagNameFor('sample-feature')).toBe('FEATURE_SAMPLE_FEATURE');
  });

  it('keeps platform-floor modules on regardless of env', () => {
    const flags = loadFlags({ FEATURE_IDENTITY: 'false' });
    expect(isModuleEnabled(flags, 'identity')).toBe(true);
  });

  it('honours an explicit opt-out for optional modules', () => {
    const flags = loadFlags({ FEATURE_ASSESSMENT: 'false' });
    expect(isModuleEnabled(flags, 'assessment')).toBe(false);
  });
});
