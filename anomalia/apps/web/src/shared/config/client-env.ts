import { loadClientEnv } from '@anomalia/config/client';

/**
 * Validated once per process. Importing this instead of touching
 * `process.env` means a missing variable is a loud error at module load
 * rather than `undefined` rendered into a fetch URL.
 */
export const clientEnv = loadClientEnv();
