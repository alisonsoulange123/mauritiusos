import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';

export interface DatabaseOptions {
  url: string;
  poolMax?: number;
  ssl?: boolean;
  logQueries?: boolean;
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
