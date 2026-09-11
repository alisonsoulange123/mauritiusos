import type { DatabaseHandle } from '@anomalia/db';

/**
 * DI token for the database handle.
 *
 * Repositories inject this token rather than importing a module-level
 * singleton, which is what makes a repository testable with a stub and keeps
 * connection lifecycle in core's hands.
 */
export const DATABASE = Symbol.for('anomalia.core.Database');
export type DatabaseRef = DatabaseHandle;
