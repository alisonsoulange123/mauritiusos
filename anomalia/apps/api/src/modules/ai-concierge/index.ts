import { z } from 'zod';
import { IDENTITY_CONTRACT, IMMIGRATION_CONTRACT, KNOWLEDGE_CONTRACT } from '@anomalia/contracts';
import { defineModule } from '../../core/module-system/module.definition.js';
import { AiConciergeModule } from './ai-concierge.module.js';

/**
 * AI CONCIERGE — the orchestrator (DDD §13, AI blueprint §3).
 *
 * Owns no data of its own. It gathers authorized context from other contexts,
 * hands it to the Python worker, and persists the conversation. The
 * Engineering Standards §2.4 rule is absolute here: the frontend never calls
 * an LLM, and neither does this module — the worker does.
 */
export default defineModule({
  key: 'ai-concierge',
  version: '1.0.0',
  description: 'Conversation orchestration, memory and delegation to the Python AI worker.',
  nestModule: AiConciergeModule,
  stability: 'beta',
  configSchema: z.object({
    AI_CONCIERGE_MAX_CONTEXT_ITEMS: z.coerce.number().int().min(1).max(20).default(6),
    AI_CONCIERGE_MEMORY_LIMIT: z.coerce.number().int().min(1).max(100).default(20),
    AI_CONCIERGE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  }),
  consumes: [KNOWLEDGE_CONTRACT, IMMIGRATION_CONTRACT, IDENTITY_CONTRACT],
  dependsOn: ['knowledge', 'immigration', 'identity'],
  publishes: ['ai.plan.requested'],
  subscribes: ['ai.plan.generated', 'knowledge.item.published'],
});
