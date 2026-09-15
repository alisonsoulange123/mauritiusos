import { and, eq, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Tenant-scoping helpers.
 *
 * Defence in depth. The application layer must *never* be the only thing
 * keeping tenants apart, so isolation is enforced three times:
 *
 *   1. `withTenant()` here — every repository composes its filters through it.
 *   2. Postgres row-level security — see `rlsPolicyFor()`; even a repository
 *      bug cannot read another tenant's rows.
 *   3. `TenantContext` in the API — a request with no resolvable tenant is
 *      rejected before it reaches a repository at all.
 */

export interface TenantScopedTable {
  tenantId: PgColumn;
}

/**
 * Composes a tenant filter with the caller's own predicates.
 * Prefer this over hand-written `eq(table.tenantId, …)`: the helper is what
 * the boundary linter greps for.
 */
export function withTenant<T extends TenantScopedTable>(
  table: T,
  tenantId: string,
  ...predicates: Array<SQL | undefined>
): SQL {
  const filters = [eq(table.tenantId, tenantId), ...predicates].filter(
    (predicate): predicate is SQL => predicate !== undefined,
  );
  // `and` with at least one filter always yields a SQL node.
  return and(...filters) as SQL;
}

/** Values injected into every tenant-scoped INSERT. */
export const tenantValues = (tenantId: string) => ({ tenantId });

/**
 * Emits the RLS policy for a table — for a NEW module's migration.
 *
 * The existing tables are covered by `0002_tenant_isolation.sql`, which is the
 * source of truth; this exists so a module adding a tenant-scoped table has
 * the same policy to paste rather than one reinvented slightly differently.
 *
 * Note what it deliberately does NOT emit: `FORCE ROW LEVEL SECURITY`. The
 * policy binds the application role, not the table owner, because migrations
 * and the seed run as the owner with no tenant set — forcing it would make
 * seeding fail on its first insert. Owner bypass is the reason the app is
 * given a separate unprivileged role, not a gap in it.
 *
 * A tenant-scoped table that never gets this is caught by the integration
 * suite, which asserts that every table carrying `tenant_id` has a policy.
 */
export const rlsPolicyFor = (tableName: string): string => `
ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "${tableName}_tenant_isolation" ON "${tableName}";
CREATE POLICY "${tableName}_tenant_isolation" ON "${tableName}"
  USING (tenant_id = NULLIF(current_setting('reef_technologies.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('reef_technologies.tenant_id', true), '')::uuid);
`;