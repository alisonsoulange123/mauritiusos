import type { z } from 'zod';
import { coreEnvSchema, withProductionInvariants, type CoreEnv } from './env.schema';

export interface LoadEnvOptions {
  /** Defaults to `process.env`; injectable so tests never mutate globals. */
  source?: Record<string, string | undefined>;
  /**
   * Extra schemas contributed by enabled modules. Each enabled module's
   * `configSchema` is merged in; a disabled module's env vars are never
   * required, which is what lets you run the API with a module switched off.
   */
  moduleSchemas?: Array<{ key: string; schema: z.ZodObject<z.ZodRawShape> }>;
}

export interface LoadedEnv<TExtra extends Record<string, unknown> = Record<string, unknown>> {
  core: CoreEnv;
  modules: TExtra;
  /** Safe to log: secrets replaced with a fingerprint, never the value. */
  redacted: Record<string, unknown>;
}

const SECRET_PATTERN = /(SECRET|TOKEN|PASSWORD|KEY|DSN|CREDENTIAL)/i;

const redact = (env: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(env).map(([key, value]) => {
      if (!SECRET_PATTERN.test(key) || value == null) return [key, value];
      const asString = String(value);
      return [key, `«redacted:${asString.length}ch»`];
    }),
  );

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

/**
 * Loads and validates configuration ONCE, at boot, and crashes the process if
 * anything is wrong.
 *
 * Fail-fast is the whole point: a missing DATABASE_URL should kill the
 * container on startup, not surface as a 500 to a user three hours later.
 * Nothing downstream ever reads `process.env` again.
 */
export function loadServerEnv<TExtra extends Record<string, unknown> = Record<string, unknown>>(
  options: LoadEnvOptions = {},
): LoadedEnv<TExtra> {
  const source = options.source ?? process.env;
  const moduleSchemas = options.moduleSchemas ?? [];

  const coreResult = withProductionInvariants(coreEnvSchema).safeParse(source);
  if (!coreResult.success) {
    throw new Error(
      `Invalid core configuration — refusing to start.\n${formatIssues(coreResult.error)}\n` +
        'See .env.example for the full contract.',
    );
  }

  const modules: Record<string, unknown> = {};
  const moduleFailures: string[] = [];

  for (const { key, schema } of moduleSchemas) {
    const parsed = schema.safeParse(source);
    if (!parsed.success) {
      moduleFailures.push(`[module: ${key}]\n${formatIssues(parsed.error)}`);
      continue;
    }
    Object.assign(modules, parsed.data);
  }

  if (moduleFailures.length) {
    throw new Error(
      `Invalid module configuration — refusing to start.\n${moduleFailures.join('\n')}\n` +
        'Disable the module in src/modules/registry.ts, or supply its variables.',
    );
  }

  return {
    core: coreResult.data,
    modules: modules as TExtra,
    redacted: redact({ ...coreResult.data, ...modules }),
  };
}
