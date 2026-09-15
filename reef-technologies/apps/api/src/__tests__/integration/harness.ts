import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';
import type { INestApplication } from '@nestjs/common';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE INTEGRATION HARNESS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Boots the REAL application against a real Postgres and a real Redis, listens
 * on an ephemeral port, and drives it over HTTP.
 *
 * Every claim this repository makes about behaviour — reuse detection revokes
 * every session, an advisor cannot mint an admin, publication needs a source,
 * a refresh token is refused as a bearer — was until now verified by hand with
 * curl, once, and then trusted forever. These tests exist to make those claims
 * fail on a commit instead of in a demo.
 *
 * Deliberately NOT mocked. The behaviours worth guarding live in the seams:
 * middleware order, the global deny-by-default guard, the Zod pipe, the error
 * filter, tenant resolution, the throttler's real request context. A test that
 * calls a use case directly proves none of them, and those are exactly where
 * the bugs found in this codebase have been.
 *
 * Skips rather than fails when there is no infrastructure, matching the Redis
 * tests: `pnpm verify` stays runnable on a laptop with nothing up, and CI —
 * which provides both services — runs them for real.
 */

/**
 * The OWNER connection. Used by the harness itself to provision and tear down
 * a test tenant — and by nothing else, because row-level security is bypassed
 * for a table's owner.
 */
const OWNER_URL =
  process.env.TEST_DATABASE_URL ??
  'postgres://reef_technologies:reef_technologies@localhost:5432/reef_technologies';

/**
 * The APPLICATION connection, which the booted app is given.
 *
 * Deliberately a different, unprivileged role, so the suite exercises the
 * database policies rather than sailing past them. Falls back to the owner
 * when no application role exists, which keeps the suite runnable — the test
 * that asserts isolation checks its own connection and skips instead of
 * passing vacuously.
 */
const APP_URL = process.env.TEST_APP_DATABASE_URL ?? OWNER_URL;

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

export interface Harness {
  /** e.g. `http://127.0.0.1:41234/api/v1` */
  readonly url: string;
  /** The tenant slug this run is isolated to. */
  readonly tenant: string;
  /**
   * A second, real tenant.
   *
   * Cross-tenant tests need one that EXISTS, or the tenancy middleware rejects
   * the request as unresolvable (400) before authorization is ever consulted —
   * which would pass a test about isolation for entirely the wrong reason.
   */
  readonly otherTenant: string;
  /** Owner connection: provisioning and assertions the app could not make. */
  readonly pool: Pool;
  /** The connection the app uses — unprivileged, subject to RLS. */
  readonly appPool: Pool;
  /** Whether the app really is on a separate role, so RLS is in play. */
  readonly rlsEnforced: boolean;
  request(path: string, init?: RequestInit & { token?: string; tenant?: string }): Promise<Response>;
  json<T>(path: string, init?: RequestInit & { token?: string; tenant?: string }): Promise<T>;
  close(): Promise<void>;
}

export interface HarnessOptions {
  /**
   * Face the real rate limiter.
   *
   * Off by default: a suite driving dozens of sign-ins from one source address
   * would exhaust the ten-per-minute credential bucket within a few cases and
   * fail for a reason none of those tests is about. The limiter honours
   * `skipIf: config.isTest`, so this option works by booting under a different
   * NODE_ENV rather than by replacing the guard — overriding it is what a
   * previous attempt did, and `overrideGuard` silently does nothing to a guard
   * registered through APP_GUARD.
   */
  throttle?: boolean;
}

/** Whether the infrastructure this suite needs is actually running. */
export async function infrastructureAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString: OWNER_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  /*
   * Environment BEFORE the import, not after.
   *
   * `app.module.ts` calls `loadServerEnv()` at module scope, so configuration
   * is read the instant the module is imported — a top-level import here would
   * bind the app to whatever the environment happened to be, which in a test
   * runner is nothing. Hence the dynamic imports below.
   */
  const tenant = `test-${randomUUID().slice(0, 8)}`;
  const otherTenant = `${tenant}-other`;

  Object.assign(process.env, {
    // `staging` when a test wants the real limiter; see HarnessOptions.
    NODE_ENV: options.throttle ? 'staging' : 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: APP_URL,
    REDIS_URL,
    JWT_SECRET: 'integration-test-secret-of-sufficient-length',
    DEFAULT_TENANT_SLUG: tenant,
    API_PREFIX: 'api/v1',
    // In-memory, so a test run neither reads nor writes the Redis streams a
    // developer may have a worker attached to.
    EVENT_BUS_DRIVER: 'memory',
    MAIL_TRANSPORT: 'log',
    APP_PUBLIC_URL: 'http://localhost:3000',
    // Short enough that a test can watch an access token expire without
    // sleeping for fifteen minutes.
    JWT_ACCESS_TTL_SECONDS: '900',
    AUTH_REFRESH_GRACE_SECONDS: '1',
  });

  const pool = new Pool({ connectionString: OWNER_URL });
  const appPool = new Pool({ connectionString: APP_URL });
  await provisionTenant(pool, tenant);
  await provisionTenant(pool, otherTenant);

  const { Test } = await import('@nestjs/testing');
  const { AppModule, bootConfig } = await loadCompiledApp();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule as never] }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });

  // The same global setup `main.ts` performs. Anything omitted here is a
  // difference between what is tested and what is deployed.
  app.setGlobalPrefix(bootConfig.API_PREFIX);
  app.enableShutdownHooks();

  // Port 0: the OS picks a free one, so suites can run in parallel.
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/${bootConfig.API_PREFIX}`.replace('[::1]', '127.0.0.1');

  const request = async (
    path: string,
    init: RequestInit & { token?: string; tenant?: string } = {},
  ): Promise<Response> => {
    const { token, tenant: tenantOverride, headers, ...rest } = init;
    return fetch(`${url}${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        'x-reef-technologies-tenant': tenantOverride ?? tenant,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
  };

  return {
    url,
    tenant,
    otherTenant,
    pool,
    appPool,
    rlsEnforced: APP_URL !== OWNER_URL,
    request,
    async json<T>(path: string, init?: RequestInit & { token?: string; tenant?: string }) {
      const response = await request(path, init);
      return (await response.json()) as T;
    },
    async close() {
      await app.close();
      // Rows first, then the tenant: every table is tenant-scoped, so this
      // leaves the developer's own database exactly as it was found.
      await cleanupTenant(pool, tenant).catch(() => undefined);
      await cleanupTenant(pool, otherTenant).catch(() => undefined);
      await appPool.end().catch(() => undefined);
      await pool.end().catch(() => undefined);
    },
  };
}

/**
 * Loads the app from `dist/`, not from `src/`.
 *
 * Not a preference — a constraint with a silver lining. Vitest transforms with
 * esbuild, which does not implement `emitDecoratorMetadata` at all, so Nest's
 * dependency injection by type resolves to `undefined` and the container
 * refuses to build. The usual remedy is an SWC transformer plugin; this
 * workspace cannot take one today because its pnpm store has moved and adding a
 * dependency would force a full reinstall.
 *
 * The silver lining is real: an integration test that boots `dist/` exercises
 * the exact artifact the Docker image runs, including anything the build itself
 * might get wrong. The cost is that the suite needs a build first, which is why
 * it lives behind `pnpm test:integration` rather than inside `pnpm test`.
 */
async function loadCompiledApp(): Promise<{ AppModule: unknown; bootConfig: { API_PREFIX: string } }> {
  /*
   * Resolved from the working directory rather than from `import.meta.url`:
   * this package compiles to CommonJS, where `import.meta` is a type error,
   * and package scripts always run with the package as their cwd — under
   * vitest directly and under turbo alike.
   */
  const compiled = resolve(process.cwd(), 'dist', 'app.module.js');

  if (!existsSync(compiled)) {
    throw new Error(
      'dist/app.module.js is missing — integration tests boot the compiled app.\n' +
        'Run `pnpm --filter @reef-technologies/api build` first, or use `pnpm test:integration`.',
    );
  }

  return (await import(pathToFileURL(compiled).href)) as {
    AppModule: unknown;
    bootConfig: { API_PREFIX: string };
  };
}

/**
 * A tenant per run, with a random slug.
 *
 * Isolation, not convenience: the suite writes users, knowledge and audit rows,
 * and a developer running it against the database they also develop against
 * should not find test accounts in their own directory afterwards.
 */
async function provisionTenant(pool: Pool, slug: string): Promise<void> {
  await pool.query(
    `INSERT INTO tenants (slug, name, country, default_locale, supported_locales, currency, timezone, status)
     VALUES ($1, $1, 'MU', 'en', '["en","fr"]'::jsonb, 'MUR', 'Indian/Mauritius', 'active')
     ON CONFLICT (slug) DO NOTHING`,
    [slug],
  );
}

async function cleanupTenant(pool: Pool, slug: string): Promise<void> {
  const { rows } = await pool.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [slug]);
  const id = rows[0]?.id;
  if (!id) return;

  // Ordered so a table is emptied before anything that might reference it.
  for (const table of [
    'knowledge_embeddings',
    'knowledge_items',
    'knowledge_sources',
    'ai_messages',
    'ai_sessions',
    'ai_user_memory',
    'assessment_sessions',
    'identity_user_profiles',
    'identity_users',
    'audit_log',
  ]) {
    await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [id]).catch(() => undefined);
  }
  await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
}

/** Registers an account and returns its id and tokens. */
export async function registerUser(
  harness: Harness,
  email: string,
  password = 'an-integration-test-passphrase',
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const created = await harness.json<{ user_id: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  const session = await harness.json<{ access_token: string; refresh_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  return {
    userId: created.user_id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  };
}

/** Grants a role directly, for tests that need one without exercising the endpoint. */
export async function grantRole(harness: Harness, email: string, role: string): Promise<void> {
  await harness.pool.query(
    `UPDATE identity_users SET role = $2, email_verified_at = now()
     WHERE email = $1 AND tenant_id = (SELECT id FROM tenants WHERE slug = $3)`,
    [email, role, harness.tenant],
  );
}
