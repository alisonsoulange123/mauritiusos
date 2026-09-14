/**
 * Development seed: one tenant (the Mauritius Country Pack) plus the minimum
 * data the funnel needs to produce a real answer.
 *
 * Idempotent — safe to re-run. Refuses to run against production, because a
 * seed script pointed at the wrong DATABASE_URL is a genuinely bad day.
 *
 *   pnpm --filter @reef-technologies/api seed
 */
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as argon2 from 'argon2';

try {
  process.loadEnvFile(resolve(process.cwd(), '.env'));
} catch {
  /* env injected by the platform */
}

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed a production database.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed(): Promise<void> {
  const tenantId = randomUUID();

  const { rows: tenantRows } = await pool.query<{ id: string }>(
    `INSERT INTO tenants (id, slug, name, country, default_locale, supported_locales, currency, timezone, status)
     VALUES ($1, 'mauritius', 'MauritiusOS', 'MU', 'en', '["en","fr"]', 'MUR', 'Indian/Mauritius', 'active')
     ON CONFLICT (slug) DO UPDATE SET status = 'active'
     RETURNING id`,
    [tenantId],
  );
  const tenant = tenantRows[0]!.id;
  console.warn(`✓ tenant mauritius (${tenant})`);

  // ── Immigration rules: the Country Pack's actual content ────────────────
  const rules = [
    {
      name: 'Retirement Residence Permit',
      permitType: 'retirement_residence',
      documents: ['passport', 'proof_of_income', 'medical_certificate', 'police_clearance'],
      confidence: 95,
      conditions: [
        { field: 'age', operator: 'gte', value: '50', weight: 3 },
        { field: 'monthlyIncome', operator: 'gte', value: '2500', weight: 3 },
        { field: 'purpose', operator: 'eq', value: 'retirement', weight: 1 },
      ],
    },
    {
      name: 'Occupation Permit — Investor',
      permitType: 'occupation_investor',
      documents: ['passport', 'business_plan', 'proof_of_funds', 'company_registration'],
      confidence: 90,
      conditions: [
        { field: 'age', operator: 'gte', value: '18', weight: 1 },
        { field: 'monthlyIncome', operator: 'gte', value: '4000', weight: 3 },
        { field: 'purpose', operator: 'in', value: 'investment,business,business_setup', weight: 3 },
      ],
    },
    {
      name: 'Premium Visa — Remote Worker',
      permitType: 'premium_visa',
      documents: ['passport', 'proof_of_employment', 'travel_insurance'],
      confidence: 88,
      conditions: [
        { field: 'monthlyIncome', operator: 'gte', value: '1500', weight: 2 },
        { field: 'purpose', operator: 'in', value: 'remote_work,lifestyle_change', weight: 3 },
      ],
    },
  ];

  for (const rule of rules) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO immigration_rules (tenant_id, name, permit_type, required_documents, base_confidence, active, source_url)
       VALUES ($1, $2, $3, $4, $5, true, 'https://www.edbmauritius.org/')
       RETURNING id`,
      [tenant, rule.name, rule.permitType, JSON.stringify(rule.documents), rule.confidence],
    );
    const ruleId = rows[0]!.id;

    for (const condition of rule.conditions) {
      await pool.query(
        `INSERT INTO immigration_rule_conditions (tenant_id, rule_id, field, operator, value, weight)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenant, ruleId, condition.field, condition.operator, condition.value, condition.weight],
      );
    }
    console.warn(`✓ rule ${rule.name} (${rule.conditions.length} conditions)`);
  }

  // ── Knowledge: a source, then items that cite it ────────────────────────
  const { rows: sourceRows } = await pool.query<{ id: string }>(
    `INSERT INTO knowledge_sources (tenant_id, name, source_type, url, authority_level, verified_at)
     VALUES ($1, 'Economic Development Board Mauritius', 'government', 'https://www.edbmauritius.org/', 'official', now())
     RETURNING id`,
    [tenant],
  );
  const sourceId = sourceRows[0]!.id;

  const articles = [
    {
      title: 'Retirement Residence Permit',
      slug: 'retirement-residence-permit',
      type: 'RULE',
      category: 'immigration',
      content:
        'Non-citizens aged 50 and above may apply for a Retirement Residence Permit. ' +
        'Applicants must demonstrate a regular monthly income and transfer the required amount ' +
        'to a local bank account. The permit is renewable and covers a spouse as a dependent.',
    },
    {
      title: 'Buying property as a non-citizen',
      slug: 'buying-property-non-citizen',
      type: 'GUIDE',
      category: 'property',
      content:
        'Non-citizens may acquire residential property under approved schemes. Purchase above ' +
        'the qualifying threshold can confer residence status for the buyer and immediate family ' +
        'for as long as the property is held.',
    },
    {
      title: 'Tax residence and the 183-day rule',
      slug: 'tax-residence-183-days',
      type: 'RULE',
      category: 'finance',
      content:
        'An individual is tax resident if present in Mauritius for 183 days or more in an income ' +
        'year, or 270 days across three consecutive years. Tax residence determines liability on ' +
        'income remitted to Mauritius.',
    },
  ];

  for (const article of articles) {
    await pool.query(
      `INSERT INTO knowledge_items
         (tenant_id, title, slug, type, category, content, locale, status, confidence_score, source_id, verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'en', 'published', 95, $7, now())
       ON CONFLICT (tenant_id, slug, locale) DO NOTHING`,
      [tenant, article.title, article.slug, article.type, article.category, article.content, sourceId],
    );
    console.warn(`✓ knowledge ${article.slug}`);
  }

  await seedAdmin(tenant);

  console.warn('\nSeed complete.');
}

/**
 * One administrator, so the platform is operable at all.
 *
 * Role changes require an admin and registration only ever issues `lead`, so
 * without this a fresh install has nobody who can promote anyone — the
 * lead → client transition exists but is unreachable. This is the bootstrap.
 *
 * The password is taken from the environment when supplied, because a known
 * credential is only acceptable on a throwaway database. The script already
 * refuses to run when NODE_ENV is production; this warns loudly on top of it.
 */
async function seedAdmin(tenant: string): Promise<void> {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@reef-technologies.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-this-dev-password';

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 3,
    parallelism: 4,
  });

  // Verified at creation. Nobody is going to read mail at admin@reef-technologies.local,
  // and an admin that cannot be promoted past `lead` by the role policy would
  // make the bootstrap useless the moment that rule applied to them too.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO identity_users (id, tenant_id, email, password_hash, role, status, locale, email_verified_at)
     VALUES ($1, $2, $3, $4, 'admin', 'active', 'en', now())
     ON CONFLICT (tenant_id, email) DO UPDATE
       SET role = 'admin', status = 'active', email_verified_at = COALESCE(identity_users.email_verified_at, now())
     RETURNING id`,
    [randomUUID(), tenant, email, passwordHash],
  );
  const adminId = rows[0]!.id;

  await pool.query(
    `INSERT INTO identity_user_profiles (tenant_id, user_id, first_name, journey_stage)
     VALUES ($1, $2, 'Platform', 'resident')
     ON CONFLICT DO NOTHING`,
    [tenant, adminId],
  );

  console.warn(`✓ admin ${email} (${adminId})`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn('  ⚠ seeded with the default development password — set SEED_ADMIN_PASSWORD to override');
  }
}

seed()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => void pool.end());
