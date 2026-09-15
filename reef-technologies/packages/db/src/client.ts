import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';

export interface DatabaseOptions {
  url: string;
  poolMax?: number;
  ssl?: boolean;
  logQueries?: boolean;
  /**
   * The tenant the current asynchronous context belongs to, if any.
   *
   * Supplied as a callback rather than a value because it changes per request,
   * and injected rather than imported so this package stays free of the API's
   * `TenantContext` — `packages/db` knows what a tenant id is and nothing
   * about how one is resolved.
   *
   * Without it the row-level security policies see no tenant and every read
   * returns nothing, because only `runAsTenant` sets the variable and just
   * eleven of the forty-six database call sites in this codebase go through it.
   */
  currentTenantId?: () => string | undefined;
}

export type Database = NodePgDatabase<Record<string, never>>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  /** Runs `fn` inside a transaction with the tenant session variable set. */
  runAsTenant: <T>(tenantId: string, fn: (db: Database) => Promise<T>) => Promise<T>;
  healthcheck: () => Promise<boolean>;
  close: () => Promise<void>;
}

/**
 * Creates the pool and the Drizzle handle.
 *
 * The schema is *not* passed in. Each module owns its tables and imports them
 * directly into its own repository; the shared client stays schema-agnostic so
 * `packages/db` never has to know which modules exist. drizzle-kit discovers
 * the tables by globbing `apps/api/src/**\/*.schema.ts` at generate time.
 */
export function createDatabase(options: DatabaseOptions): DatabaseHandle {
  const config: PoolConfig = {
    connectionString: options.url,
    max: options.poolMax ?? 10,
    ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
    application_name: 'reef-technologies-api',
  };

  const pool = new Pool(config);
  if (options.currentTenantId) applyTenantOnCheckout(pool, options.currentTenantId);

  const db = drizzle(pool, { logger: options.logQueries ?? false });

  /**
   * Sets `reef_technologies.tenant_id` for the duration of a transaction so the RLS
   * policies apply. `set_config(..., true)` is transaction-local, so a pooled
   * connection can never leak the setting into the next request.
   */
  const runAsTenant = async <T>(tenantId: string, fn: (tx: Database) => Promise<T>): Promise<T> =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('reef_technologies.tenant_id', ${tenantId}, true)`);
      return fn(tx as unknown as Database);
    });

  const healthcheck = async (): Promise<boolean> => {
    try {
      await db.execute(sql`SELECT 1`);
      return true;
    } catch {
      return false;
    }
  };

  return { db, pool, runAsTenant, healthcheck, close: () => pool.end() };
}

/** Remembers which tenant a pooled connection was last configured for. */
const CONFIGURED_TENANT = Symbol('reef_technologies.configuredTenant');

type TaggedClient = { [CONFIGURED_TENANT]?: string; query: (text: string, values?: unknown[]) => Promise<unknown> };

/**
 * Sets the tenant variable on every connection as it leaves the pool.
 *
 * Row-level security reads a session variable, and something has to put it
 * there. `runAsTenant` does it inside a transaction, which covers the writes —
 * but most reads in this codebase go straight to `db`, outside any
 * transaction, and with the policies live those would all come back empty.
 *
 * Doing it at checkout means no call site changes and nothing to forget. A
 * query cannot escape it: a connection that has not been configured has not
 * been handed out.
 *
 * The statement is skipped when the connection already carries the right
 * tenant, which is the common case — a pool serving one tenant sets it once
 * per physical connection rather than once per query. The tag is cleared by
 * setting the empty string, so a borrower with no tenant cannot inherit the
 * last one's.
 */
function applyTenantOnCheckout(pool: Pool, currentTenantId: () => string | undefined): void {
  const connect = pool.connect.bind(pool) as () => Promise<unknown>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg's connect is overloaded
  (pool as any).connect = async function tenantAwareConnect(...args: unknown[]) {
    // The callback form is used internally by `pool.query`; both end up here.
    if (typeof args[0] === 'function') {
      const callback = args[0] as (error: unknown, client?: unknown, done?: unknown) => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- delegating to pg
      return (connect as any)(async (error: unknown, client: unknown, done: unknown) => {
        if (error) return callback(error, client, done);
        try {
          await configure(client as TaggedClient, currentTenantId());
        } catch (configurationError) {
          return callback(configurationError, client, done);
        }
        return callback(error, client, done);
      });
    }

    const client = (await connect()) as TaggedClient;
    await configure(client, currentTenantId());
    return client;
  };
}

async function configure(client: TaggedClient, tenantId: string | undefined): Promise<void> {
  const wanted = tenantId ?? '';
  if (client[CONFIGURED_TENANT] === wanted) return;

  /*
   * Session-level, not transaction-local.
   *
   * `set_config(..., true)` outside an explicit transaction lasts only for the
   * statement that issues it, so the very next query would run with no tenant.
   * Session scope survives until the connection is reconfigured, which the tag
   * above guarantees happens before it serves a different tenant.
   */
  await client.query("SELECT set_config('reef_technologies.tenant_id', $1, false)", [wanted]);
  client[CONFIGURED_TENANT] = wanted;
}
