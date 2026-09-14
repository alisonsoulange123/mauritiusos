import { z } from 'zod';

/**
 * Env vars are always strings. These coercions keep that ugliness in one file
 * instead of sprinkling `=== 'true'` across the codebase.
 */

/** Accepts true/false/1/0/yes/no, case-insensitive. */
export const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${value}" is not a boolean` });
    return z.NEVER;
  });

export const portFromEnv = z.coerce.number().int().min(1).max(65535);

export const durationSecondsFromEnv = z.coerce.number().int().positive();

/** Comma-separated list -> trimmed, non-empty array. */
export const listFromEnv = z
  .string()
  .transform((value) => value.split(',').map((item) => item.trim()).filter(Boolean));

/** A secret that must be genuinely present — rejects the usual placeholders. */
export const secretFromEnv = (minLength = 32) =>
  z
    .string()
    .min(minLength, `must be at least ${minLength} characters`)
    .refine(
      (value) => !/^(changeme|placeholder|secret|todo|xxx+)$/i.test(value),
      'looks like a placeholder — set a real value',
    );

export const postgresUrl = z
  .string()
  .url()
  .refine((value) => /^postgres(ql)?:\/\//.test(value), 'must be a postgres:// URL');

export const redisUrl = z
  .string()
  .url()
  .refine((value) => /^rediss?:\/\//.test(value), 'must be a redis:// URL');
