import type { DatabaseHandle } from '@reef-technologies/db';

/**
 * DI token for the database handle.
 *
 * Repositories inject this token rather than importing a module-level
 * singleton, which is what makes a repository testable with a stub and keeps
 * connection lifecycle in core's hands.
 */
export const DATABASE = Symbol.for('reef_technologies.core.Database');
export type DatabaseRef = DatabaseHandle;
