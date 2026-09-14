import { describe, expect, it } from 'vitest';
import { TenantResolver } from '../tenant.resolver.js';

// Host parsing touches no database, so the dependency is never reached.
const resolver = new TenantResolver(null as never);
const slug = (host: string) => resolver.slugFromHost(host);

describe('slugFromHost', () => {
  it('reads the tenant from a subdomain', () => {
    expect(slug('portal.mauritius.reef_technologies.io')).toBe('mauritius');
    expect(slug('mauritius.reef_technologies.io')).toBe('mauritius');
  });

  it('ignores www', () => {
    expect(slug('www.reef_technologies.io')).toBeUndefined();
  });

  it('falls through for a bare host', () => {
    // One or two labels carry no tenant, so the caller uses its default.
    expect(slug('localhost')).toBeUndefined();
    expect(slug('reef_technologies.io')).toBeUndefined();
  });

  it('never reads a tenant out of an IPv4 address', () => {
    /*
     * The bug this guards. `127.0.0.1` splits into four labels, so taking the
     * third from last produced the slug "0": every request that reached the API
     * by address rather than by name — a container calling a sibling, a load
     * balancer probe, the image's own healthcheck — resolved a tenant that does
     * not exist and was refused 400. Invisible locally, because `localhost` has
     * one label and falls through.
     */
    expect(slug('127.0.0.1')).toBeUndefined();
    expect(slug('10.0.12.4')).toBeUndefined();
    expect(slug('192.168.1.1:4000')).toBeUndefined();
  });

  it('never reads a tenant out of an IPv6 address', () => {
    expect(slug('::1')).toBeUndefined();
    expect(slug('[::1]:4000')).toBeUndefined();
    expect(slug('[2001:db8::1]')).toBeUndefined();
  });

  it('strips a port before counting labels', () => {
    expect(slug('portal.mauritius.reef_technologies.io:443')).toBe('mauritius');
    expect(slug('localhost:4000')).toBeUndefined();
  });

  it('is case-insensitive, as host names are', () => {
    expect(slug('Portal.Mauritius.Reef Technologies.IO')).toBe('mauritius');
  });
});
