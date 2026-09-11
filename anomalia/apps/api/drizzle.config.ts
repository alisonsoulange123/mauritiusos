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
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
  migrations: { table: '__anomalia_migrations', schema: 'public' },
});
