import { z } from 'zod';
import { IDENTITY_CONTRACT, IMMIGRATION_CONTRACT, KNOWLEDGE_CONTRACT } from '@reef-technologies/contracts';
import { defineModule } from '../../core/module-system/module.definition.js';
import { AssessmentModule } from './assessment.module.js';

/**
 * ASSESSMENT — the conversion funnel (API Contract §5, UX §5).
 *
 * The most instructive module in the repo for coupling, because it is the most
 * connected one: it consumes three contracts and publishes two events. Read
 * its `consumes` list and you know its blast radius exactly — and the loader
 * refuses to boot if any of those three providers is disabled, so a
 * misconfigured deployment fails at startup rather than at a user's first
 * submission.
 */
export default defineModule({
  key: 'assessment',
  version: '1.0.0',
  description: 'Visitor assessment funnel: questions, scoring and first recommendation.',
  nestModule: AssessmentModule,
  stability: 'stable',
  configSchema: z.object({
    /** Below this score, route to nurture content rather than a sales path. */
    ASSESSMENT_QUALIFIED_SCORE: z.coerce.number().int().min(0).max(100).default(60),
    ASSESSMENT_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  }),
  consumes: [IMMIGRATION_CONTRACT, KNOWLEDGE_CONTRACT, IDENTITY_CONTRACT],
  dependsOn: ['immigration', 'knowledge', 'identity'],
  publishes: ['assessment.started', 'assessment.completed'],
});
