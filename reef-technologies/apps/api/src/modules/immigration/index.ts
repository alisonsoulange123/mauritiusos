import { z } from 'zod';
import { IMMIGRATION_CONTRACT } from '@reef-technologies/contracts';
import { defineModule } from '../../core/module-system/module.definition.js';
import { ImmigrationModule } from './immigration.module.js';

/**
 * IMMIGRATION — the Immigration Context and the rules half of the Decision
 * Engine (DDD §4, AI blueprint §11).
 *
 * The AI must never decide eligibility itself. It calls this module, which
 * evaluates declarative rules and returns an explainable outcome. That
 * separation is what keeps immigration answers auditable rather than
 * hallucinated.
 */
export default defineModule({
  key: 'immigration',
  version: '1.0.0',
  description: 'Permit rules, eligibility evaluation and document requirements.',
  nestModule: ImmigrationModule,
  stability: 'stable',
  configSchema: z.object({
    /** Outcomes below this are not surfaced as recommendations at all. */
    IMMIGRATION_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  }),
  provides: [IMMIGRATION_CONTRACT],
  publishes: ['immigration.eligibility.evaluated'],
});
