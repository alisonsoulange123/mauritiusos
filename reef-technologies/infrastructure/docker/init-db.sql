-- Extensions the platform assumes exist. Run once, at first container start.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";      -- knowledge embeddings (RAG)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy lexical search
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- so "Rivière" matches "Riviere"

-- A non-superuser role for the application.
--
-- This is not ceremony: row-level security is BYPASSED by superusers and by
-- table owners. Running the API as the owner would silently disable every
-- tenant isolation policy, which is the one failure mode that must not be
-- possible. Migrations run as the owner; the app runs as this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reef_technologies_app') THEN
    CREATE ROLE reef_technologies_app LOGIN PASSWORD 'reef_technologies_app';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE reef_technologies TO reef_technologies_app;
GRANT USAGE ON SCHEMA public TO reef_technologies_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO reef_technologies_app;
