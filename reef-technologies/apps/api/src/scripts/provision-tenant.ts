/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TENANT PROVISIONING — the bootstrap a real environment needs.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A freshly migrated database serves nothing. Every table is tenant-scoped and
 * the tenancy middleware rejects a request it cannot resolve, so without a
 * tenant row the whole platform answers 400 — and with row-level security in
 * force, an unscoped connection reads an empty database. "Create the first
 * tenant" is therefore a deployment step, not an afterthought.
 *
 * The deliberate opposite of `seed.ts` in three ways:
 *
 *   It RUNS in production. The seed refuses to, because a seed pointed at the
 *   wrong database is a bad day; this is the tool you are supposed to reach for
 *   there, so refusing would leave no supported way to stand an environment up.
 *
 *   It creates NO demo data. A tenant and its first administrator, nothing
 *   else — no sample rules, no knowledge articles, no fixtures to discover in
 *   production six months later.
 *
 *   It takes its values from YOU. No defaults that quietly become a real
 *   deployment's identity.
 *
 * Connect as the schema OWNER. It writes `identity_users`, which row-level
 * security protects, and there is no tenant context to set yet — the tenant is
 * what this is creating.
 *
 *   pnpm --filter @reef-technologies/api provision -- \
 *     --slug=portugal --name="Portugal" --country=PT \
 *     --admin-email=ops@example.com
 *
 * Idempotent: re-running reports what already exists and never overwrites a
 * tenant's settings or resets an administrator's password.
 */
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  /* env injected by the platform */
}

interface Options {
  slug: string;
  name: string;
  country: string;
  defaultLocale: string;
  supportedLocales: string[];
  currency: string;
  timezone: string;
  adminEmail: string;
  adminPassword: string | null;
}

/** A host segment, so the same characters a DNS label allows and no others. */
const SLUG = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Mirrors IDENTITY_PASSWORD_MIN_LENGTH's default; overridden by the env var. */
const MIN_PASSWORD_LENGTH = Number(process.env.IDENTITY_PASSWORD_MIN_LENGTH ?? 12);
const ARGON_MEMORY_KIB = Number(process.env.IDENTITY_ARGON_MEMORY_KIB ?? 65536);

function parseArguments(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (const entry of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(entry);
    if (match) flags.set(match[1]!, match[2]!);
  }

  const read = (flag: string, fallback?: string): string =>
    flags.get(flag) ?? process.env[`TENANT_${flag.toUpperCase().replace(/-/g, '_')}`] ?? fallback ?? '';

  const options: Options = {
    slug: read('slug'),
    name: read('name'),
    country: read('country').toUpperCase(),
    defaultLocale: read('default-locale', 'en'),
    supportedLocales: read('supported-locales', 'en').split(',').map((locale) => locale.trim()).filter(Boolean),
    currency: read('currency', 'MUR').toUpperCase(),
    timezone: read('timezone', 'Indian/Mauritius'),
    adminEmail: read('admin-email').trim().toLowerCase(),
    adminPassword: flags.get('admin-password') ?? process.env.TENANT_ADMIN_PASSWORD ?? null,
  };

  validate(options);
  return options;
}

/** Everything that would make a tenant unusable, reported in one pass. */
function validate(options: Options): void {
  const problems: string[] = [];

  if (!SLUG.test(options.slug)) {
    problems.push('--slug must be a DNS-safe label: lowercase letters, digits and hyphens');
  }
  if (!options.name) problems.push('--name is required');
  if (!/^[A-Z]{2}$/.test(options.country)) {
    problems.push('--country must be an ISO 3166-1 alpha-2 code');
  }
  if (!EMAIL.test(options.adminEmail)) problems.push('--admin-email must be an email address');
  if (options.adminPassword !== null && options.adminPassword.length < MIN_PASSWORD_LENGTH) {
    problems.push(`--admin-password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (!options.supportedLocales.includes(options.defaultLocale)) {
    // Otherwise the tenant's own default is not one of the languages it serves,
    // and locale negotiation falls back to a language it does not support.
    problems.push('--default-locale must appear in --supported-locales');
  }

  // All of them at once: fixing one flag only to be told about the next is a
  // miserable way to stand up an environment.
  if (problems.length) {
    throw new Error(`Cannot provision:\n${problems.map((problem) => `  • ${problem}`).join('\n')}`);
  }
}

/**
 * A password nobody chose badly.
 *
 * base64url of 24 random bytes: 32 characters, no ambiguity about shell
 * quoting, and well past any policy floor. Printed once and never stored in
 * plain text — if it is lost, the recovery flow exists for exactly that.
 */
const generatePassword = (): string => randomBytes(24).toString('base64url');

const pool = new Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL,
});

async function provision(options: Options): Promise<void> {
  const password = options.adminPassword ?? generatePassword();
  const generated = options.adminPassword === null;

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: ARGON_MEMORY_KIB,
    timeCost: 3,
    parallelism: 4,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /*
     * Created as `provisioning`, flipped to `active` at the end.
     *
     * The resolver only accepts an active tenant, so a run that dies half way
     * leaves something no request can reach rather than a tenant with no
     * administrator — visible to an operator, invisible to the internet.
     */
    const { rows: existing } = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM tenants WHERE slug = $1',
      [options.slug],
    );

    const tenantId = existing[0]?.id ?? randomUUID();
    const tenantExisted = existing.length > 0;

    if (!tenantExisted) {
      await client.query(
        `INSERT INTO tenants
           (id, slug, name, country, default_locale, supported_locales, currency, timezone, status)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'provisioning')`,
        [
          tenantId,
          options.slug,
          options.name,
          options.country,
          options.defaultLocale,
          JSON.stringify(options.supportedLocales),
          options.currency,
          options.timezone,
        ],
      );
    }

    const { rows: admins } = await client.query<{ id: string }>(
      'SELECT id FROM identity_users WHERE tenant_id = $1 AND email = $2',
      [tenantId, options.adminEmail],
    );
    const adminExisted = admins.length > 0;

    if (!adminExisted) {
      const adminId = randomUUID();
      await client.query(
        `INSERT INTO identity_users
           (id, tenant_id, email, password_hash, role, status, locale, email_verified_at)
         VALUES ($1, $2, $3, $4, 'admin', 'active', $5, now())`,
        // Verified on creation: the first administrator cannot click a
        // confirmation link into a platform that does not serve requests yet,
        // and the role policy refuses to promote an unconfirmed account.
        [adminId, tenantId, options.adminEmail, passwordHash, options.defaultLocale],
      );
      await client.query(
        `INSERT INTO identity_user_profiles (tenant_id, user_id, journey_stage)
         VALUES ($1, $2, 'resident')`,
        [tenantId, adminId],
      );
    }

    // Only now is the tenant reachable.
    await client.query("UPDATE tenants SET status = 'active' WHERE id = $1 AND status <> 'suspended'", [
      tenantId,
    ]);

    await client.query('COMMIT');
    report(options, { tenantId, tenantExisted, adminExisted, password, generated });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface Outcome {
  tenantId: string;
  tenantExisted: boolean;
  adminExisted: boolean;
  password: string;
  generated: boolean;
}

function report(options: Options, outcome: Outcome): void {
  console.warn(`\n${outcome.tenantExisted ? '=' : '✓'} tenant ${options.slug} (${outcome.tenantId})`);
  if (outcome.tenantExisted) {
    console.warn('  already existed — settings left untouched');
  }

  console.warn(`${outcome.adminExisted ? '=' : '✓'} admin ${options.adminEmail}`);
  if (outcome.adminExisted) {
    // Never silently reset a password: that would turn a re-run into a way to
    // take over an administrator account.
    console.warn('  already existed — password NOT changed');
  } else if (outcome.generated) {
    console.warn('\n  ┌─ Administrator password, shown once ───────────────────────');
    console.warn(`  │  ${outcome.password}`);
    console.warn('  └────────────────────────────────────────────────────────────');
    console.warn('  Store it now. It is hashed here and cannot be recovered —');
    console.warn('  a lost one is replaced through the password reset flow.\n');
  }

  console.warn(`Send the tenant header as: x-reef-technologies-tenant: ${options.slug}`);
}

/*
 * Parsing happens INSIDE the chain. Called as an argument to `provision` it
 * threw synchronously, before any promise existed, so the handler below never
 * ran and a mistyped flag printed a stack trace instead of the list of what
 * was wrong with it.
 */
Promise.resolve()
  .then(() => provision(parseArguments(process.argv.slice(2))))
  .catch((error: unknown) => {
    console.error(`\n✗ provisioning failed\n\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
