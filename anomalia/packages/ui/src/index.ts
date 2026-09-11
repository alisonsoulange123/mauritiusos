/**
 * Shared design-system exports.
 *
 * Primitives live in each app's `components/ui` while the system is still
 * settling; once a component is used by two apps it is promoted here. Moving
 * it earlier just means versioning a decision you have not made yet.
 */
export { cn } from './cn';
export type { Tone, Size } from './tokens';
