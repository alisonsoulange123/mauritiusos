import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { infrastructureAvailable, registerUser, startHarness, type Harness } from './harness.js';

/**
 * The third layer of tenant isolation, exercised against Postgres.
 *
 * The other two — `TenantContext` rejecting an unresolvable tenant, and
 * `withTenant()` on every repository query — are application code, and the
 * whole point of this layer is to survive a bug in them. So these tests do the
 * thing a buggy repository would do: query without a tenant filter, and check
 * the database refuses to hand over another tenant's rows anyway.
 */
let harness: Harness | null = null;

beforeAll(async () => {
  if (await infrastructureAvailable()) harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

const withApi = (name: string, body: (api: Harness) => Promise<void>) =>
  it(name, async (ctx) => {
    if (!harness) ctx.skip();
    await body(harness as Harness);
  });

/**
 * Only meaningful when the app connects as a role the policies bind. Skips
 * loudly rather than passing when it does not — a green test that proved
 * nothing would be worse than no test at all.
 */
const withRls = (name: string, body: (api: Harness) => Promise<void>) =>
  it(name, async (ctx) => {
    if (!harness) ctx.skip();
    const api = harness as Harness;
    // Set TEST_APP_DATABASE_URL to the unprivileged role to exercise this.
    if (!api.rlsEnforced) ctx.skip();
    await body(api);
  });

const tenantIdOf = async (api: Harness, slug: string): Promise<string> => {
  const { rows } = await api.pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [
    slug,
  ]);
  return rows[0]!.id;
};

describe('row-level security', () => {
  withRls('hides another tenant’s rows from a query that forgot to filter', async (api) => {
    await registerUser(api, 'mine@example.com');

    // A row belonging to the OTHER tenant, written as the owner so it exists
    // beyond doubt.
    const otherId = await tenantIdOf(api, api.otherTenant);
    await api.pool.query(
      `INSERT INTO identity_users (tenant_id, email, password_hash, role, status, locale)
       VALUES ($1, 'theirs@example.com', 'x', 'lead', 'active', 'en')`,
      [otherId],
    );

    // Exactly what a repository bug looks like: no WHERE tenant_id.
    const connection = await api.appPool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('reef_technologies.tenant_id', $1, true)", [
        await tenantIdOf(api, api.tenant),
      ]);
      const { rows } = await connection.query<{ email: string }>('SELECT email FROM identity_users');
      await connection.query('COMMIT');

      const emails = rows.map((row) => row.email);
      expect(emails).toContain('mine@example.com');
      expect(emails).not.toContain('theirs@example.com');
    } finally {
      connection.release();
    }
  });

  withRls('refuses to write a row into another tenant', async (api) => {
    const otherId = await tenantIdOf(api, api.otherTenant);

    const connection = await api.appPool.connect();
    try {
      await connection.query('BEGIN');
      await connection.query("SELECT set_config('reef_technologies.tenant_id', $1, true)", [
        await tenantIdOf(api, api.tenant),
      ]);

      // The `WITH CHECK` half of the policy. Without it, isolation would stop
      // reads while still letting a bug plant rows in someone else's tenant.
      await expect(
        connection.query(
          `INSERT INTO identity_users (tenant_id, email, password_hash, role, status, locale)
           VALUES ($1, 'planted@example.com', 'x', 'lead', 'active', 'en')`,
          [otherId],
        ),
      ).rejects.toThrow(/row-level security/i);

      await connection.query('ROLLBACK');
    } finally {
      connection.release();
    }
  });

  withRls('shows nothing at all when no tenant is set', async (api) => {
    await registerUser(api, 'unset@example.com');

    // `current_setting(..., true)` returns NULL with no tenant, and NULL
    // compares to nothing — so a connection that never set one reads an empty
    // database rather than the whole of it.
    const connection = await api.appPool.connect();
    try {
      const { rows } = await connection.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM identity_users',
      );
      expect(rows[0]!.count).toBe('0');
    } finally {
      connection.release();
    }
  });
});

describe('policy coverage', () => {
  withApi('protects every table that carries a tenant_id', async (api) => {
    /*
     * The enforcement that keeps this from rotting.
     *
     * A module adding a tenant-scoped table and forgetting its policy would
     * reintroduce exactly the gap this work closed — silently, because
     * everything still passes with the application filters in place. This
     * turns that omission into a failing test.
     *
     * `tenants` is excluded on purpose: it is the tenant registry rather than
     * tenant data, and the resolver must read it BEFORE any tenant is known.
     */
    const { rows } = await api.pool.query<{ table_name: string; protected: boolean }>(`
      SELECT c.relname AS table_name, c.relrowsecurity AS protected
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_name = c.relname AND col.column_name = 'tenant_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
      ORDER BY c.relname
    `);

    const unprotected = rows.filter((row) => !row.protected).map((row) => row.table_name);

    expect(rows.length).toBeGreaterThan(10);
    expect(unprotected).toEqual([]);
  });

  withApi('gives every protected table an isolation policy, not just the flag', async (api) => {
    // ENABLE ROW LEVEL SECURITY with no policy denies everything to the app
    // role — a table that reads as empty rather than one that leaks. Both are
    // wrong, and the flag alone does not distinguish them.
    const { rows } = await api.pool.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.relname)
    `);

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });
});

describe('tenant lifecycle', () => {
  withApi('serves nothing for a tenant still being provisioned', async (api) => {
    /*
     * Why provisioning creates the tenant as `provisioning` and flips it to
     * `active` only once its first administrator exists.
     *
     * The resolver accepts active tenants only, so a provisioning run that
     * dies half way leaves something an operator can see and the internet
     * cannot reach — rather than a live tenant with no way in. This asserts
     * the half-built state really is closed, which is what makes that ordering
     * worth anything.
     */
    const slug = `${api.tenant}-halfbuilt`;
    await api.pool.query(
      `INSERT INTO tenants (slug, name, country, default_locale, supported_locales, currency, timezone, status)
       VALUES ($1, $1, 'MU', 'en', '["en"]'::jsonb, 'MUR', 'Indian/Mauritius', 'provisioning')`,
      [slug],
    );

    try {
      const response = await api.request('/auth/me', { tenant: slug });
      // Refused at the tenancy middleware, before authentication is consulted.
      expect(response.status).toBe(400);
    } finally {
      await api.pool.query('DELETE FROM tenants WHERE slug = $1', [slug]);
    }
  });

  withApi('serves a suspended tenant nothing either', async (api) => {
    // Same gate, used for the opposite reason: switching a tenant off must
    // take effect without a deploy.
    const slug = `${api.tenant}-suspended`;
    await api.pool.query(
      `INSERT INTO tenants (slug, name, country, default_locale, supported_locales, currency, timezone, status)
       VALUES ($1, $1, 'MU', 'en', '["en"]'::jsonb, 'MUR', 'Indian/Mauritius', 'suspended')`,
      [slug],
    );

    try {
      expect((await api.request('/auth/me', { tenant: slug })).status).toBe(400);
    } finally {
      await api.pool.query('DELETE FROM tenants WHERE slug = $1', [slug]);
    }
  });
});
