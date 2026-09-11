/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE FEATURE REGISTRY — the frontend's single point of registration.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Adding a feature:
 *   1. Create `src/features/<key>/` with an `index.ts` exporting a definition.
 *   2. Add one import + one array entry below.
 *
 * Nothing else. Navigation, routing and flag gating are all derived from this
 * array, so there is no route table to update, no nav component to edit and no
 * `if (flags.x)` scattered through the layout.
 *
 * Each entry imports only the feature's `index.ts` — metadata, no components.
 * The screens themselves arrive through `mount()`, which is a dynamic import,
 * so this file stays cheap no matter how many features exist.
 */
import type { FeatureDefinition } from './feature.definition';

import assessment from './assessment';
import aiConcierge from './ai-concierge';
import knowledgeExplorer from './knowledge-explorer';

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  assessment,
  aiConcierge,
  knowledgeExplorer,

  // ── Planned. Each ships behind its backend module's flag. ───────────────
  // roadmap,        // requiresModules: ['relocation']
  // documentVault,  // requiresModules: ['documents']
  // partnerFinder,  // requiresModules: ['marketplace']
];

export const findFeature = (key: string): FeatureDefinition | undefined =>
  FEATURE_REGISTRY.find((feature) => feature.key === key);
