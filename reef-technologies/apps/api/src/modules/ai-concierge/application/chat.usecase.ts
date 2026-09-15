import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { IDENTITY_CONTRACT, IMMIGRATION_CONTRACT, KNOWLEDGE_CONTRACT } from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { AiWorkerClient } from './ai-worker.client.js';
import { aiMessages, aiSessions, userMemory } from '../infrastructure/ai-concierge.schema.js';

type AiConciergeEnv = {
  AI_CONCIERGE_MAX_CONTEXT_ITEMS: number;
  AI_CONCIERGE_MEMORY_LIMIT: number;
};

/**
 * One chat turn, following the AI blueprint's pipeline (§14):
 *
 *   message → memory → knowledge → rules → LLM → persisted answer
 *
 * The ordering is the guardrail. Knowledge and eligibility are resolved BEFORE
 * the model is called, so the model's job is to phrase verified facts rather
 * than to recall them. That is what makes "never invent immigration
 * information" an architectural property instead of a prompt instruction.
 */
@Injectable()
export class ChatUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly contracts: ContractRegistry,
    private readonly worker: AiWorkerClient,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  async execute(input: { userId: string; message: string; sessionId?: string }) {
    const tenantId = this.tenantContext.requireTenantId();
    const env = this.config.module<AiConciergeEnv>();
    const locale = this.tenantContext.locale();

    const sessionId = input.sessionId ?? (await this.openSession(tenantId, input.userId, locale));

    // ── Retrieve verified knowledge first ────────────────────────────────
    const knowledge = this.contracts.tryGet(KNOWLEDGE_CONTRACT);
    const hits = knowledge
      ? await knowledge.search({ query: input.message, limit: env.AI_CONCIERGE_MAX_CONTEXT_ITEMS })
      : [];

    // ── Long-term memory, highest importance first ───────────────────────
    const memories = await this.database.db
      .select({ key: userMemory.memoryKey, value: userMemory.memoryValue })
      .from(userMemory)
      .where(and(eq(userMemory.tenantId, tenantId), eq(userMemory.userId, input.userId)))
      .orderBy(desc(userMemory.importance))
      .limit(env.AI_CONCIERGE_MEMORY_LIMIT);

    // ── Decision Engine step (AI blueprint §14) ─────────────────────────
    // Resolve eligibility BEFORE the model runs, so the answer restates a
    // rules-engine verdict rather than inventing one. Both lookups degrade:
    // a user with an incomplete profile still gets a knowledge-grounded reply.
    /*
     * Fetched once and used twice: the model needs the profile as context, and
     * the rules engine needs it as input. It used to be read only inside the
     * eligibility resolution, so the worker was handed `profile: null` even
     * when one existed.
     */
    const profile = await this.loadProfile(input.userId);
    const eligibility = await this.resolveEligibility(profile);

    await this.recordMessage(tenantId, sessionId, 'user', input.message);

    const response = await this.worker.chat({
      message: input.message,
      userId: input.userId,
      sessionId,
      locale,
      context: {
        // Spread into a plain record: the worker's context is deliberately
        // schemaless on this field, and the contract's view is a typed object.
        profile: profile ? { ...profile } : null,
        eligibility,
        knowledge: hits.map((hit) => ({
          id: hit.knowledgeId,
          title: hit.title,
          excerpt: hit.excerpt,
          confidence: hit.confidence,
        })),
        memory: memories,
      },
    });

    await this.recordMessage(tenantId, sessionId, 'assistant', response.answer, response);

    return {
      session_id: sessionId,
      answer: response.answer,
      sources: response.citations,
      confidence: response.confidence,
      actions: response.suggestedActions,
      // Surfaced to the UI so a low-confidence answer is visibly hedged and
      // offers an advisor, per the guardrails in §16.
      requires_human_review: response.confidence < this.config.core.AI_HUMAN_REVIEW_THRESHOLD,
    };
  }

  /**
   * Profile -> eligibility, via two contracts, neither of which this module
   * imports. Returns null whenever the chain cannot complete, because a chat
   * reply is still useful without an eligibility verdict.
   */
  /** The profile, or null when identity is disabled or the person has none. */
  private async loadProfile(userId: string) {
    const identity = this.contracts.tryGet(IDENTITY_CONTRACT);
    return identity ? await identity.getProfile(userId) : null;
  }

  private async resolveEligibility(
    profile: Awaited<ReturnType<ChatUseCase['loadProfile']>>,
  ): Promise<Record<string, unknown> | null> {
    const immigration = this.contracts.tryGet(IMMIGRATION_CONTRACT);
    if (!immigration) return null;

    /*
     * An incomplete profile yields no verdict rather than a guessed one. That
     * is the guardrail working: the concierge restates a rules-engine result,
     * so with nothing to run the rules on it must say nothing — which, until
     * profiles were ever written, was every signed-in user.
     */
    if (
      !profile?.nationality ||
      profile.age === null ||
      profile.monthlyIncome === null ||
      !profile.familyStatus
    ) {
      return null;
    }

    const outcome = await immigration.evaluateBest({
      nationality: profile.nationality,
      age: profile.age,
      monthlyIncome: profile.monthlyIncome,
      currency: profile.currency ?? 'EUR',
      familyStatus: profile.familyStatus,
      purpose: 'relocation',
    });

    return outcome ? { ...outcome } : null;
  }

  private async openSession(tenantId: string, userId: string, locale: string): Promise<string> {
    const sessionId = randomUUID();
    await this.database.db.insert(aiSessions).values({ id: sessionId, tenantId, userId, locale });
    return sessionId;
  }

  private async recordMessage(
    tenantId: string,
    sessionId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    response?: { citations: string[]; confidence: number; usage?: { promptTokens: number; completionTokens: number } },
  ): Promise<void> {
    await this.database.db.insert(aiMessages).values({
      tenantId,
      sessionId,
      role,
      content,
      citations: response?.citations ?? [],
      confidence: response ? Math.round(response.confidence * 100) : null,
      promptTokens: response?.usage?.promptTokens ?? null,
      completionTokens: response?.usage?.completionTokens ?? null,
    });
  }
}
