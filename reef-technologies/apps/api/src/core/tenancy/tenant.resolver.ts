import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, type DatabaseRef } from '../database/database.tokens.js';
import { Inject } from '@nestjs/common';
import { tenants } from '../database/core.schema.js';

export interface ResolvedTenant {
  id: string;
  slug: string;
  country: string;
  defaultLocale: string;
  supportedLocales: string[];
  currency: string;
  status: string;
}

/**
 * Resolves a tenant slug to a tenant row, with an in-process cache.
 *
 * Tenants change roughly never and are needed on every single request, so
 * hitting Postgres each time would add a query to the critical path for no
 * reason. TTL is short enough that suspending a tenant takes effect within a
 * minute without a deploy.
 */
@Injectable()
export class TenantResolver {
  private readonly logger = new Logger(TenantResolver.name);
  private readonly cache = new Map<string, { tenant: ResolvedTenant | null; expiresAt: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(@Inject(DATABASE) private readonly database: DatabaseRef) {}

  /**
   * `portal.mauritius.reef_technologies.io` -> `mauritius`; unknown shapes -> undefined.
   *
   * IP literals are rejected before the dots are counted, and that is not a
   * nicety: `127.0.0.1` splits into four labels, so the old implementation read
   * the third from last and resolved the tenant slug `0`. Every request
   * reaching the API by address rather than by name — a container talking to a
   * sibling, a load balancer's health probe, the app's own healthcheck — looked
   * up a tenant that does not exist and was refused with a 400.
   *
   * It survived local development because `localhost` has one label and falls
   * through to the default, and appeared the moment the API ran in a container.
   */
  slugFromHost(host: string): string | undefined {
    const hostname = stripPort(host);
    if (!hostname || isIpLiteral(hostname)) return undefined;

    const parts = hostname.split('.');
    if (parts.length < 3) return undefined;

    const candidate = parts.at(-3);
    return candidate && candidate !== 'www' ? candidate : undefined;
  }

  negotiateLocale(acceptLanguage: string | undefined, tenantDefault = 'en'): string {
    if (!acceptLanguage) return tenantDefault;
    const preferred = acceptLanguage.split(',')[0]?.split('-')[0]?.toLowerCase();
    return preferred && ['en', 'fr'].includes(preferred) ? preferred : tenantDefault;
  }

  async resolve(slug: string): Promise<ResolvedTenant | null> {
    const cached = this.cache.get(slug);
    if (cached && cached.expiresAt > Date.now()) return cached.tenant;

    const rows = await this.database.db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    const row = rows[0];
    // A suspended tenant resolves to null: its users get a clean 400 rather
    // than partial access to a tenant that is meant to be switched off.
    const tenant: ResolvedTenant | null =
      row && row.status === 'active'
        ? {
            id: row.id,
            slug: row.slug,
            country: row.country,
            defaultLocale: row.defaultLocale,
            supportedLocales: row.supportedLocales,
            currency: row.currency,
            status: row.status,
          }
        : null;

    if (!tenant) this.logger.debug(`tenant "${slug}" not found or inactive`);
    this.cache.set(slug, { tenant, expiresAt: Date.now() + TenantResolver.TTL_MS });
    return tenant;
  }

  invalidate(slug?: string): void {
    if (slug) this.cache.delete(slug);
    else this.cache.clear();
  }
}

/**
 * Express's `hostname` normally strips the port, but this is called with
 * whatever the caller has — and a bare `Host` header carries one.
 */
function stripPort(host: string): string {
  const trimmed = host.trim().toLowerCase();

  // A bracketed IPv6 literal: `[::1]:4000`.
  if (trimmed.startsWith('[')) return trimmed.slice(1, trimmed.indexOf(']'));

  const colon = trimmed.lastIndexOf(':');
  // A lone colon is a port separator; several mean an unbracketed IPv6 address,
  // which has no port to strip.
  const hasSinglePort = colon > 0 && trimmed.indexOf(':') === colon;
  return hasSinglePort ? trimmed.slice(0, colon) : trimmed;
}

/** Addresses are never tenant names, in either family. */
function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(':')) return true; // IPv6, bracket-stripped by now
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}
