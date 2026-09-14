/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE MODULE REGISTRY — the one file you edit to add or remove a module.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Adding a module:
 *   1. Create `src/modules/<key>/` (copy `sample-feature`).
 *   2. Add its key to MODULE_KEYS in `@reef-technologies/contracts`.
 *   3. Add one import + one array entry below.
 *
 * That is the entire integration. No core file changes, no central schema
 * file, no app.module edit, no route table. Removing a module is the same in
 * reverse: delete the directory and its line here.
 *
 * The loader validates this array at boot — missing dependencies, duplicate
 * contracts, unknown event names and dependency cycles all fail at startup
 * rather than in production. See core/module-system/module-loader.ts.
 *
 * ORDER IN THIS ARRAY IS IRRELEVANT. The loader topologically sorts by
 * `dependsOn`, so you never hand-maintain an initialisation sequence.
 */
import type { ReefTechnologiesModuleDefinition } from '../core/module-system/module.definition.js';

import sampleFeature from './sample-feature/index.js';
import identity from './identity/index.js';
import knowledge from './knowledge/index.js';
import immigration from './immigration/index.js';
import assessment from './assessment/index.js';
import aiConcierge from './ai-concierge/index.js';

export const MODULE_REGISTRY: readonly ReefTechnologiesModuleDefinition[] = [
  // ── Platform floor ──────────────────────────────────────────────────────
  identity,

  // ── Intelligence layer ──────────────────────────────────────────────────
  knowledge,
  immigration,
  aiConcierge,

  // ── Conversion funnel ───────────────────────────────────────────────────
  assessment,

  // ── Template. Delete once your own modules exist. ───────────────────────
  sampleFeature,

  // ── Not yet built. Uncomment as each lands. ─────────────────────────────
  // relocation,   // RelocationCase aggregate + task journey
  // documents,    // Document Vault (pre-signed URLs, virus scan, expiry)
  // marketplace,  // Partner directory, matching, commissions
  // property,     // Property + Area + investment calculators
  // finance,      // Tax estimator, bank matcher
  // analytics,    // Event rollups, funnel metrics
  // billing,      // Lemon Squeezy / Paddle subscriptions
];
