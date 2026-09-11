import { z } from 'zod';
import { booleanFromEnv } from './primitives';

/**
 * Browser-visible configuration.
 *
 * Every key is NEXT_PUBLIC_ prefixed and this schema is the allowlist: if a
 * value is not declared here it cannot reach the client, so a server secret
 * can never be shipped in a bundle by accident.
 */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4000/api/v1'),
  NEXT_PUBLIC_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  NEXT_PUBLIC_DEFAULT_TENANT: z.string().default('mauritius'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['en', 'fr']).default('en'),
  /** Local overrides for flags; the API's capability response still wins. */
  NEXT_PUBLIC_FLAG_OVERRIDES: z.string().default(''),
  NEXT_PUBLIC_ENABLE_DEVTOOLS: booleanFromEnv.default(false),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so the keys must
 * be written out literally — a dynamic lookup would evaluate to undefined in
 * the browser bundle.
 */
export function loadClientEnv(): ClientEnv {
  const parsed = clientEnvSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
    NEXT_PUBLIC_DEFAULT_TENANT: process.env.NEXT_PUBLIC_DEFAULT_TENANT,
    NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
    NEXT_PUBLIC_FLAG_OVERRIDES: process.env.NEXT_PUBLIC_FLAG_OVERRIDES,
    NEXT_PUBLIC_ENABLE_DEVTOOLS: process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid client configuration:\n${parsed.error.issues
        .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data;
}
