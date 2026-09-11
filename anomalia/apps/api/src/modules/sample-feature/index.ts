import { defineModule } from '../../core/module-system/module.definition.js';
import { SAMPLE_FEATURE_CONTRACT } from '@anomalia/contracts';
import { z } from 'zod';
import { SampleFeatureModule } from './sample-feature.module.js';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  SAMPLE FEATURE — the reference implementation. Copy this directory.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * It exercises every integration point a real module has, so you can see the
 * whole contract in one place:
 *
 *   • a self-declaring module definition (this file)
 *   • its OWN Drizzle table, discovered by glob            infrastructure/
 *   • a domain entity with invariants and no framework     domain/
 *   • use cases that orchestrate                           application/
 *   • a repository PORT in domain, ADAPTER in infra        (hexagonal)
 *   • an outbound event                                    publishes:
 *   • an inbound subscription with idempotency             subscribes:
 *   • a published contract other modules may call          provides:
 *   • a consumed contract from another module              consumes:
 *   • its own env vars, validated                          configSchema
 *   • REST + OpenAPI interface                             interface/http/
 *
 * Layer rule, enforced by the boundary linter:
 *   interface → application → domain ← infrastructure
 * Dependencies point INWARD. The domain imports nothing outward.
 */
export default defineModule({
  key: 'sample-feature',
  version: '1.0.0',
  description: 'Reference module demonstrating the ANOMALIA module contract.',
  nestModule: SampleFeatureModule,
  stability: 'stable',

  /** Merged into the validated config. Prefixed with the module key. */
  configSchema: z.object({
    SAMPLE_FEATURE_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(25),
    SAMPLE_FEATURE_ALLOW_ANONYMOUS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  }),

  /** What other modules may call synchronously. */
  provides: [SAMPLE_FEATURE_CONTRACT],

  /**
   * Deliberately empty. A module with no `consumes` and no `dependsOn` can be
   * deleted with zero impact on anything else — the target state for most
   * modules. Reach for events first; add a contract only when you need an
   * answer in the same request.
   */
  consumes: [],

  publishes: ['sample-feature.item.created'],

  /**
   * Note there is no `dependsOn: ['identity']` here even though we react to
   * its event. A subscriber must tolerate its publisher being absent — the
   * events simply never arrive. Only `consumes` justifies a hard dependency.
   */
  subscribes: ['identity.user.registered'],
});
