import { z } from 'zod';
import { MODULE_KEYS, type ModuleKey } from '@anomalia/contracts';
import { booleanFromEnv } from './primitives';

/**
 * Feature flags are derived mechanically from module keys:
 *   `sample-feature` -> `FEATURE_SAMPLE_FEATURE`
 *
 * Deriving rather than hand-listing means a new module cannot be forgotten
 * here, and the frontend can compute the same flag name from the same key.
 */
export const flagNameFor = (key: ModuleKey): string =>
  `FEATURE_${key.replace(/-/g, '_').toUpperCase()}`;

/** Modules that constitute the platform floor — not switchable off. */
export const ALWAYS_ON: readonly ModuleKey[] = ['identity'];

/** MVP scope from the blueprints: the four questions a visitor arrives with. */
export const DEFAULT_ENABLED: readonly ModuleKey[] = [
  'identity',
  'assessment',
  'knowledge',
  'immigration',
  'ai-concierge',
  'sample-feature',
];

/** One `booleanFromEnv` with the right default per module key. */
type FlagShape = Record<string, ReturnType<(typeof booleanFromEnv)['default']>>;

export const flagsSchema = z.object(
  Object.fromEntries(
    MODULE_KEYS.map((key) => [
      flagNameFor(key),
      booleanFromEnv.default(DEFAULT_ENABLED.includes(key)),
    ]),
  ) as FlagShape,
);

export type FlagSet = Record<string, boolean>;

export const isModuleEnabled = (flags: FlagSet, key: ModuleKey): boolean =>
  ALWAYS_ON.includes(key) || flags[flagNameFor(key)] === true;

export function loadFlags(source: Record<string, string | undefined> = process.env): FlagSet {
  const parsed = flagsSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid feature flags:\n${parsed.error.issues
        .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}`,
    );
  }
  return parsed.data as FlagSet;
}
