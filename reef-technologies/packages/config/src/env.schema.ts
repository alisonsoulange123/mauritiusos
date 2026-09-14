import { z } from 'zod';
import { booleanFromEnv, durationSecondsFromEnv, listFromEnv, portFromEnv, postgresUrl, redisUrl, secretFromEnv } from './primitives';

/**
 * CORE environment schema — global concerns only.
 *
 * Deliberately excludes anything module-specific. A module declares its own
 * env vars in its module definition (`configSchema`) and the loader merges
 * them in, so adding a module never touches this file. That is the config half
 * of "registering a module requires one file".
 */
export const coreEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  APP_NAME: z.string().default('reef-technologies-api'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── HTTP ────────────────────────────────────────────────────────────────
  PORT: portFromEnv.default(4000),
  API_PREFIX: z.string().default('api/v1'),
  CORS_ORIGINS: listFromEnv.default('http://localhost:3000'),

  // ── Persistence ─────────────────────────────────────────────────────────
  DATABASE_URL: postgresUrl,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_SSL: booleanFromEnv.default(false),
  REDIS_URL: redisUrl,

  // ── Identity (Security blueprint §4) ────────────────────────────────────
  JWT_SECRET: secretFromEnv(32),
  JWT_ACCESS_TTL_SECONDS: durationSecondsFromEnv.default(900),
  JWT_REFRESH_TTL_SECONDS: durationSecondsFromEnv.default(60 * 60 * 24 * 30),
  /**
   * How long a just-rotated refresh token stays acceptable.
   *
   * Reuse detection revokes every session on the account, so a false positive
   * is expensive. A browser can fire several requests at once carrying the
   * same expired access cookie, and each asks to refresh with the same token —
   * without leeway, an ordinary page load looks like an attack.
   *
   * This window is also the one hole in the protection: a replay landing
   * inside it is indistinguishable from a racing tab and is honoured. So it is
   * sized for the races that actually occur — parallel requests from a single
   * page load, which arrive within milliseconds — rather than for comfort.
   * A replay after it is detected, and the account is signed out everywhere.
   */
  AUTH_REFRESH_GRACE_SECONDS: durationSecondsFromEnv.default(5),

  /**
   * How long a password-reset link stays usable.
   *
   * Short on purpose. The link is a bearer credential that arrives in a
   * mailbox — a channel the platform does not control and cannot revoke — so
   * its value to anyone who later reads that mailbox decays on a timer.
   */
  AUTH_PASSWORD_RESET_TTL_SECONDS: durationSecondsFromEnv.default(60 * 60),
  /**
   * How long an email-verification link stays usable.
   *
   * Longer than a reset link because it grants nothing on its own: it proves
   * an address, and the account already exists either way. The cost of an
   * expired one is a resend, so it is sized for someone who reads their mail
   * the next morning.
   */
  AUTH_EMAIL_VERIFY_TTL_SECONDS: durationSecondsFromEnv.default(60 * 60 * 24),

  // ── Outbound mail ───────────────────────────────────────────────────────
  /**
   * Where recovery links point. Not derived from the request, deliberately:
   * an attacker who controls the Host header would otherwise control where a
   * password-reset link sends the victim.
   */
  APP_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** `log` prints the message and delivers nothing; `http` posts it to a provider. */
  MAIL_TRANSPORT: z.enum(['log', 'http']).default('log'),
  MAIL_FROM: z.string().default('Reef Technologies <no-reply@reef-technologies.local>'),
  /** Provider endpoint for the `http` transport (e.g. a transactional mail API). */
  MAIL_HTTP_ENDPOINT: z.string().url().optional(),
  MAIL_HTTP_TOKEN: z.string().optional(),

  // ── Multi-tenancy (§16–18) ──────────────────────────────────────────────
  /** Fallback tenant when a request carries no resolvable tenant header. */
  DEFAULT_TENANT_SLUG: z.string().default('mauritius'),
  /** Fail closed: reject requests with no tenant rather than leaking across. */
  TENANT_STRICT: booleanFromEnv.default(true),

  // ── Event bus ───────────────────────────────────────────────────────────
  /** `memory` for tests/local, `redis` everywhere else. */
  EVENT_BUS_DRIVER: z.enum(['memory', 'redis']).default('redis'),
  EVENT_STREAM_PREFIX: z.string().default('reef_technologies:events'),
  EVENT_CONSUMER_GROUP: z.string().default('reef-technologies-api'),

  // ── AI worker boundary ──────────────────────────────────────────────────
  AI_WORKER_BASE_URL: z.string().url().default('http://localhost:8000'),
  AI_WORKER_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Confidence floor below which an advisor must review (AI blueprint §17). */
  AI_HUMAN_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),

  // ── Observability ───────────────────────────────────────────────────────
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  SENTRY_DSN: z.string().url().optional(),

  // ── Storage (Document Vault, §11) ───────────────────────────────────────
  STORAGE_BUCKET: z.string().default('reef-technologies-documents'),
  STORAGE_REGION: z.string().default('eu-west-1'),
  STORAGE_ENDPOINT: z.string().url().optional(),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

/**
 * Production tripwires. Defaults that are convenient locally are dangerous in
 * production, so they are rejected outright rather than warned about.
 */
export const withProductionInvariants = <S extends z.ZodType<CoreEnv, z.ZodTypeDef, unknown>>(schema: S) =>
  schema.superRefine((env, ctx) => {
    // Applies everywhere, not just production: a transport configured to post
    // somewhere it cannot authenticate fails on the first password reset,
    // which is the worst possible moment to discover it.
    if (env.MAIL_TRANSPORT === 'http' && !(env.MAIL_HTTP_ENDPOINT && env.MAIL_HTTP_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_HTTP_ENDPOINT'],
        message: 'the "http" mail transport needs MAIL_HTTP_ENDPOINT and MAIL_HTTP_TOKEN',
      });
    }

    if (env.NODE_ENV !== 'production') return;

    if (env.EVENT_BUS_DRIVER === 'memory') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EVENT_BUS_DRIVER'],
        message: 'the in-memory bus loses events on restart; use "redis" in production',
      });
    }
    if (!env.DATABASE_SSL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DATABASE_SSL'],
        message: 'TLS to the database is mandatory in production',
      });
    }
    if (env.CORS_ORIGINS.some((origin) => origin.includes('localhost'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGINS'],
        message: 'localhost origins must not be allowed in production',
      });
    }
    if (!env.TENANT_STRICT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TENANT_STRICT'],
        message: 'tenant isolation cannot be relaxed in production',
      });
    }
    if (env.MAIL_TRANSPORT === 'log') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MAIL_TRANSPORT'],
        message: 'the "log" transport delivers nothing; password reset would silently never arrive',
      });
    }
    if (env.APP_PUBLIC_URL.includes('localhost')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_PUBLIC_URL'],
        message: 'recovery links are built from this; localhost would send every user nowhere',
      });
    }
  });
