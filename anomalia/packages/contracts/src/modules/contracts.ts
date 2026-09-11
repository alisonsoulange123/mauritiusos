import { z } from 'zod';
import { contractToken } from './contract-token';

/* ────────────────────────────────────────────────────────────────────────────
 * IMMIGRATION — the decision engine. Consumed synchronously by assessment and
 * ai-concierge because a recommendation is meaningless without eligibility.
 * ──────────────────────────────────────────────────────────────────────────── */

export const eligibilityInputSchema = z.object({
  nationality: z.string().length(2),
  age: z.number().int().min(0).max(120),
  monthlyIncome: z.number().nonnegative(),
  currency: z.string().length(3),
  familyStatus: z.enum(['single', 'couple', 'family']),
  purpose: z.string(),
});
export type EligibilityInput = z.infer<typeof eligibilityInputSchema>;

export interface EligibilityOutcome {
  permitType: string;
  eligible: boolean;
  /** 0–1. Drives the Human-in-the-loop thresholds in the AI blueprint §17. */
  confidence: number;
  /** Rule ids that fired, so the decision is explainable and auditable. */
  matchedRuleIds: string[];
  requiredDocuments: string[];
  reasons: string[];
}

export interface ImmigrationContract {
  evaluate(input: EligibilityInput): Promise<EligibilityOutcome[]>;
  /** Best single match, or null when no permit path applies. */
  evaluateBest(input: EligibilityInput): Promise<EligibilityOutcome | null>;
}

export const IMMIGRATION_CONTRACT = contractToken<ImmigrationContract>('immigration.v1');

/* ────────────────────────────────────────────────────────────────────────────
 * KNOWLEDGE — verified retrieval. Never let a module query the knowledge
 * tables directly: confidence scoring and source authority live behind here.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface KnowledgeHit {
  knowledgeId: string;
  title: string;
  slug: string;
  type: 'RULE' | 'GUIDE' | 'LOCATION' | 'PROCESS' | 'FAQ' | 'DOCUMENT';
  excerpt: string;
  confidence: number;
  sourceAuthority: 'official' | 'partner' | 'editorial' | 'community';
  lastVerifiedAt: string | null;
}

export interface KnowledgeQuery {
  query: string;
  category?: string;
  locale?: string;
  limit?: number;
  /** Discard anything below this confidence. Defaults to the tenant policy. */
  minConfidence?: number;
}

export interface KnowledgeContract {
  search(query: KnowledgeQuery): Promise<KnowledgeHit[]>;
  getBySlug(slug: string, locale: string): Promise<KnowledgeHit | null>;
}

export const KNOWLEDGE_CONTRACT = contractToken<KnowledgeContract>('knowledge.v1');

/* ────────────────────────────────────────────────────────────────────────────
 * IDENTITY — profile reads for other contexts. Deliberately narrow: no writes,
 * no credentials, no email. Least privilege applies between modules too.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface UserProfileView {
  userId: string;
  nationality: string | null;
  age: number | null;
  locale: string;
  monthlyIncome: number | null;
  currency: string | null;
  familyStatus: 'single' | 'couple' | 'family' | null;
}

export interface IdentityContract {
  getProfile(userId: string): Promise<UserProfileView | null>;
}

export const IDENTITY_CONTRACT = contractToken<IdentityContract>('identity.v1');

/* ────────────────────────────────────────────────────────────────────────────
 * SAMPLE — the template. Copy this shape for new modules.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SampleFeatureContract {
  countItems(): Promise<number>;
}

export const SAMPLE_FEATURE_CONTRACT = contractToken<SampleFeatureContract>('sample-feature.v1');
