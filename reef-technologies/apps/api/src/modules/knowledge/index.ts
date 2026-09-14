import { z } from 'zod';
import { KNOWLEDGE_CONTRACT } from '@reef-technologies/contracts';
import { defineModule } from '../../core/module-system/module.definition.js';
import { KnowledgeModule } from './knowledge.module.js';

/**
 * KNOWLEDGE — the Knowledge Context, "the brain" (DDD §3).
 *
 * Every fact the platform states about immigration, tax or property must come
 * from here, with a source and a verification date. This module is the reason
 * the AI can be told "never invent immigration information": retrieval is a
 * verified lookup, not a generation.
 */
export default defineModule({
  key: 'knowledge',
  version: '1.0.0',
  description: 'Verified knowledge base with vector retrieval and source provenance.',
  nestModule: KnowledgeModule,
  stability: 'stable',
  configSchema: z.object({
    KNOWLEDGE_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
    KNOWLEDGE_SEARCH_LIMIT: z.coerce.number().int().min(1).max(50).default(8),
    /** Items unverified for this long stop being served as authoritative. */
    KNOWLEDGE_VERIFICATION_TTL_DAYS: z.coerce.number().int().positive().default(180),
  }),
  provides: [KNOWLEDGE_CONTRACT],
  publishes: ['knowledge.item.published', 'knowledge.item.verification.expired'],
});
