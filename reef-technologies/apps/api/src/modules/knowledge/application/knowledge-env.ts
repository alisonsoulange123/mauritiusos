/**
 * The module's own validated configuration, as declared in `index.ts`.
 *
 * A `type` rather than an `interface` on purpose: `ConfigService.module<T>()`
 * constrains `T` to `Record<string, unknown>`, and TypeScript grants the
 * implicit index signature that satisfies to type aliases only. An interface
 * here fails to compile with a message that does not mention index signatures.
 */
export type KnowledgeEnv = {
  KNOWLEDGE_MIN_CONFIDENCE: number;
  KNOWLEDGE_SEARCH_LIMIT: number;
  KNOWLEDGE_VERIFICATION_TTL_DAYS: number;
};
