import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  EVENT_BUS,
  IMMIGRATION_CONTRACT,
  KNOWLEDGE_CONTRACT,
  NotFoundError,
  type EligibilityOutcome,
  type EventBus,
} from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { scoreAssessment } from '../domain/assessment-score.js';
import { assessments } from '../infrastructure/assessment.schema.js';

export interface SubmitAssessmentInput {
  assessmentId: string;
  answers: {
    nationality: string;
    age: number;
    occupation: string;
    income: number;
    currency?: string;
    family: 'single' | 'couple' | 'family';
    goal: string;
    timelineMonths?: number;
  };
  /** The signed-in caller, when there is one. Anonymous assessments omit it. */
  userId?: string;
}

export interface AssessmentResult {
  score: number;
  summary: string;
  recommendation: {
    permit: string | null;
    confidence: number;
    requiredDocuments: string[];
    knowledge: Array<{ title: string; slug: string }>;
  };
  requiresAdvisorReview: boolean;
}

/**
 * The blueprint's backend pipeline (API Contract §5.2), and the clearest
 * demonstration of cross-module orchestration in the codebase:
 *
 *   answers → eligibility (immigration) → knowledge retrieval → score → event
 *
 * Look at what this class does NOT import: no immigration module, no knowledge
 * module. It asks the registry for two interfaces declared in
 * `@reef-technologies/contracts`. Delete either provider and this file still compiles;
 * the loader catches the misconfiguration at boot, and `tryGet` lets the
 * knowledge step degrade to an empty list rather than failing the submission.
 */
@Injectable()
export class SubmitAssessmentUseCase {
  private readonly logger = new Logger(SubmitAssessmentUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly contracts: ContractRegistry,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  async execute(input: SubmitAssessmentInput): Promise<AssessmentResult> {
    const tenantId = this.tenantContext.requireTenantId();
    const { ASSESSMENT_QUALIFIED_SCORE } = this.config.module<{ ASSESSMENT_QUALIFIED_SCORE: number }>();

    const existing = await this.database.db
      .select({ id: assessments.id, status: assessments.status })
      .from(assessments)
      .where(and(eq(assessments.tenantId, tenantId), eq(assessments.id, input.assessmentId)))
      .limit(1);

    if (!existing[0]) throw new NotFoundError('assessment', input.assessmentId);

    // ── 1. Eligibility. Required: without it there is no recommendation. ──
    const immigration = this.contracts.get(IMMIGRATION_CONTRACT);
    const outcome = await immigration.evaluateBest({
      nationality: input.answers.nationality,
      age: input.answers.age,
      monthlyIncome: input.answers.income,
      currency: input.answers.currency ?? 'EUR',
      familyStatus: input.answers.family,
      purpose: input.answers.goal,
    });

    // ── 2. Knowledge. Optional: degrade rather than fail. ────────────────
    const articles = await this.lookupKnowledge(input.answers.goal, outcome?.permitType);

    // ── 3. Score ─────────────────────────────────────────────────────────
    const score = scoreAssessment({
      eligibleForPermit: outcome?.eligible ?? false,
      permitConfidence: outcome?.confidence ?? 0,
      monthlyIncome: input.answers.income,
      hasCompleteProfile: Boolean(input.answers.occupation && input.answers.nationality),
      timelineMonths: input.answers.timelineMonths ?? null,
    });

    const result = this.assembleResult(score, outcome, articles, ASSESSMENT_QUALIFIED_SCORE);

    // ── 4. Persist, then announce ────────────────────────────────────────
    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(assessments)
        .set({
          answers: input.answers,
          score,
          primaryIntent: input.answers.goal,
          outcome: result as unknown as Record<string, unknown>,
          status: 'completed',
          completedAt: new Date(),
        })
        .where(eq(assessments.id, input.assessmentId));
    });

    await this.events.publish('assessment.completed', {
      assessmentId: input.assessmentId,
      score,
      primaryIntent: normalizeIntent(input.answers.goal),
      profileSnapshot: input.answers,
      // Optional in the catalog because an anonymous assessment is a real and
      // expected case. Absent, the answers can never reach a profile.
      ...(input.userId ? { userId: input.userId } : {}),
    });

    return result;
  }
  /**
   * Optional enrichment: a knowledge outage must not fail a submission. The
   * user still gets their eligibility verdict, just without reading material.
   */
  private async lookupKnowledge(
    goal: string,
    permitType: string | undefined,
  ): Promise<Array<{ title: string; slug: string }>> {
    const knowledge = this.contracts.tryGet(KNOWLEDGE_CONTRACT);
    if (!knowledge) return [];

    try {
      const hits = await knowledge.search({ query: `${goal} ${permitType ?? ''}`.trim(), limit: 3 });
      return hits.map((hit) => ({ title: hit.title, slug: hit.slug }));
    } catch (error: unknown) {
      this.logger.warn(`knowledge lookup failed, continuing without it: ${String(error)}`);
      return [];
    }
  }

  /** Shapes the verdict for the wire, including the human-review decision. */
  private assembleResult(
    score: number,
    outcome: EligibilityOutcome | null,
    knowledge: Array<{ title: string; slug: string }>,
    qualifiedThreshold: number,
  ): AssessmentResult {
    return {
      score,
      summary: buildSummary(score, outcome?.permitType ?? null, qualifiedThreshold),
      recommendation: {
        permit: outcome?.permitType ?? null,
        confidence: outcome?.confidence ?? 0,
        requiredDocuments: outcome?.requiredDocuments ?? [],
        knowledge,
      },
      // The human-in-the-loop band from the AI blueprint §17.
      requiresAdvisorReview: (outcome?.confidence ?? 0) < this.config.core.AI_HUMAN_REVIEW_THRESHOLD,
    };
  }
}

const buildSummary = (score: number, permit: string | null, qualifiedThreshold: number): string => {
  if (!permit) {
    return 'We could not match your profile to a residence pathway yet. An advisor can review the details with you.';
  }
  if (score >= qualifiedThreshold) {
    return `Your profile matches the ${permit.replace(/_/g, ' ')} pathway. Here is what to prepare next.`;
  }
  return `The ${permit.replace(/_/g, ' ')} pathway may fit, but some requirements are not yet met.`;
};

/** Maps a free-text goal onto the catalog's closed intent set. */
const normalizeIntent = (goal: string): 'retirement' | 'investment' | 'business_setup' | 'remote_work' | 'family_relocation' | 'property_purchase' | 'lifestyle_change' => {
  const normalized = goal.toLowerCase();
  if (normalized.includes('retire')) return 'retirement';
  if (normalized.includes('invest')) return 'investment';
  if (normalized.includes('business') || normalized.includes('company')) return 'business_setup';
  if (normalized.includes('remote') || normalized.includes('digital')) return 'remote_work';
  if (normalized.includes('famil') || normalized.includes('school')) return 'family_relocation';
  if (normalized.includes('propert') || normalized.includes('house') || normalized.includes('buy')) return 'property_purchase';
  return 'lifestyle_change';
};
