import type { z } from 'zod';
import type definition from './index.js';

/**
 * Typed view of this module's env vars, inferred from the schema declared in
 * `index.ts` so the two can never drift apart.
 */
export type SampleFeatureEnv = z.infer<NonNullable<typeof definition.configSchema>>;
