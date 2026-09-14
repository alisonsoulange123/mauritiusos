import { Logger, Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { loadFlags, loadServerEnv } from '@reef-technologies/config';
import { CoreModule } from './core/core.module.js';
import { describeManifest, loadModules } from './core/module-system/module-loader.js';
import { MODULE_REGISTRY } from './modules/registry.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  COMPOSITION ROOT — the one place that knows both core and modules.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The whole architecture hinges on this file being the *only* such place.
 * Core never imports a module (the boundary linter enforces it); modules never
 * import each other. They meet here, once, and the wiring is data-driven:
 *
 *   1. read the feature flags
 *   2. resolve the registry into a validated, topologically sorted graph
 *   3. validate config, including each enabled module's own schema
 *   4. hand core the resulting manifest as a value
 *
 * Consequence: adding a module means editing `modules/registry.ts` and nothing
 * else. This file never changes again.
 *
 * Order matters. Module resolution comes BEFORE config validation, because
 * which config is required depends on which modules are enabled — running the
 * API with billing switched off must not demand a Stripe key.
 */

const bootLogger = new Logger('bootstrap');

/**
 * Loads `.env` for local development.
 *
 * Uses Node's built-in loader rather than a dotenv dependency. Deployed
 * environments inject real environment variables, so a missing file is not an
 * error — and `loadEnvFile` never OVERWRITES an existing variable, which means
 * a container's injected config always wins over a stray committed file.
 */
function loadLocalEnvFile(): void {
  if (process.env.NODE_ENV === 'production') return;
  try {
    process.loadEnvFile(resolve(process.cwd(), '.env'));
  } catch {
    // No .env present — expected in CI and in containers.
  }
}

loadLocalEnvFile();

// ── 1 & 2 ────────────────────────────────────────────────────────────────
const flags = loadFlags();
const loaded = loadModules({
  registry: MODULE_REGISTRY,
  flags,
  nodeEnv: process.env.NODE_ENV ?? 'development',
});

// ── 3 ───────────────────────────────────────────────────────────────────
const env = loadServerEnv({ moduleSchemas: loaded.configSchemas });

bootLogger.log(`\n${describeManifest(loaded.manifest)}`);
if (env.core.LOG_LEVEL === 'debug') {
  bootLogger.debug(`configuration: ${JSON.stringify(env.redacted, null, 2)}`);
}

// ── 4 ───────────────────────────────────────────────────────────────────
@Module({
  imports: [
    CoreModule.forRoot({ env, flags, manifest: loaded.manifest }),
    // Enabled modules, in dependency order. A disabled module is simply
    // absent: its routes 404, its tables stay untouched, nothing else notices.
    ...loaded.imports,
  ],
})
export class AppModule {}

/** Re-exported so main.ts can log the port and set up Swagger. */
export const bootConfig = env.core;
