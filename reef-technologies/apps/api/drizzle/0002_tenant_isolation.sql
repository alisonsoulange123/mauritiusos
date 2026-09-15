-- ════════════════════════════════════════════════════════════════════════════
--  ROW-LEVEL SECURITY — the third layer of tenant isolation.
-- ════════════════════════════════════════════════════════════════════════════
--
-- The architecture has always claimed three layers: TenantContext rejects an
-- unresolvable tenant, withTenant() filters every repository query, and
-- Postgres enforces it underneath. The third one was documentation. A helper
-- existed to emit these policies and nothing ever called it, so a repository
-- that forgot its filter had nothing beneath it.
--
-- Two deliberate choices, both of which the unused helper got wrong:
--
--   NO `FORCE ROW LEVEL SECURITY`. Policies bind the application role and not
--   the table owner, because migrations and the seed run as the owner and set
--   no tenant. Forcing it would make `pnpm seed` fail with a policy violation
--   on its first insert. Owner bypass is not a hole here — it is why the app
--   is given a separate, unprivileged role in the first place.
--
--   `tenants` is NOT protected. It is the tenant registry, not tenant data,
--   and the resolver reads it BEFORE any tenant is known. A policy on it would
--   make every request unresolvable — the isolation equivalent of locking the
--   key inside the box.

-- ── Tenant-scoped tables ───────────────────────────────────────────────────
-- `tenant_id` is NOT NULL on all of these, so the policy can be a plain
-- equality: a row belongs to exactly one tenant and is invisible to the rest.
--
-- `NULLIF(..., '')` is load-bearing. A connection with no tenant carries the
-- empty string, and `''::uuid` raises `invalid input syntax for type uuid`
-- rather than evaluating false — so an unscoped request would have died with a
-- 500 instead of simply seeing nothing. NULLIF turns it into NULL, which
-- compares to nothing and denies cleanly.

DO $$
DECLARE
  target text;
  scoped text[] := ARRAY[
    'processed_events',
    'ai_messages', 'ai_sessions', 'ai_user_memory',
    'assessment_sessions',
    'identity_users', 'identity_user_profiles',
    'immigration_rules', 'immigration_rule_conditions',
    'knowledge_items', 'knowledge_sources', 'knowledge_embeddings', 'knowledge_relations',
    'sample_items'
  ];
BEGIN
  FOREACH target IN ARRAY scoped LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target || '_tenant_isolation', target);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING (tenant_id = NULLIF(current_setting(''reef_technologies.tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''reef_technologies.tenant_id'', true), '''')::uuid)',
      target || '_tenant_isolation', target
    );
  END LOOP;
END $$;

-- ── The audit trail is the exception ───────────────────────────────────────
-- Its `tenant_id` is nullable on purpose: something worth auditing can happen
-- before a tenant is resolved — a rejected request, a failed sign-in against
-- an unknown host. The read and write rules therefore differ.
--
-- Reads are tenant-scoped, so a NULL-tenant row is never served to a tenant.
-- Writes also accept NULL, because the alternative is worse than it looks:
-- AuditService swallows its own failures by design, so a policy that rejected
-- those inserts would discard platform-level audit records in complete
-- silence. Those rows remain readable by the owner, which is where operations
-- look at them from anyway.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = NULLIF(current_setting('reef_technologies.tenant_id', true), '')::uuid)
  WITH CHECK (
    tenant_id IS NULL
    OR tenant_id = NULLIF(current_setting('reef_technologies.tenant_id', true), '')::uuid
  );

-- ── Privileges for the application role ────────────────────────────────────
-- A policy only binds a role that can reach the table at all. `init-db.sql`
-- sets default privileges for tables created afterwards, which covers a fresh
-- stack but not a database migrated before that role existed — and not CI,
-- which starts from a bare image and never runs the init script.
--
-- Guarded on the role existing so this migration stays runnable against a
-- database that has no application role at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'reef_technologies_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO reef_technologies_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO reef_technologies_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO reef_technologies_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reef_technologies_app';
  END IF;
END $$;
