import { defineConfig } from 'drizzle-kit';

/**
 * Schema discovery is a GLOB, not a list.
 *
 * This is what lets a module own its own tables: drop a `*.schema.ts` file
 * inside a module's infrastructure layer and drizzle-kit picks it up on the
 * next `db:generate`. Deleting the module directory removes its tables from
 * the next generated migration. No central schema file to edit, ever.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/core/database/*.schema.ts',
    './src/modules/*/infrastructure/*.schema.ts',
  ],
  out: './drizzle',
  /*
   * Migrations connect as the schema OWNER, which is a different role from the
   * one the application uses. Row-level security is bypassed by table owners,
   * so the app is deliberately given an unprivileged role that the policies
   * actually bind — and that role cannot create tables or policies.
   *
   * Falls back to DATABASE_URL so a developer who has not split the two still
   * gets a working `db:migrate`.
   */
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
  migrations: { table: '__reef_technologies_migrations', schema: 'public' },
});
