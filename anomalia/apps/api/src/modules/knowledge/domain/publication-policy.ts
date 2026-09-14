/**
 * When a knowledge item may be published, and how it may move between states.
 *
 * Pure and framework-free, because this is where the module's central claim is
 * actually enforced. The module's own description says every fact the platform
 * states "must come from here, with a source and a verification date" — that
 * sentence is only true if something refuses to publish items without them,
 * and until now nothing did. The invariant lived in a comment.
 */

export type KnowledgeStatus = 'draft' | 'review' | 'published' | 'archived';

export type PublicationRefusal =
  /** Provenance. An unsourced fact is an assertion, and the AI cites these. */
  | 'no-source'
  /**
   * Never verified.
   *
   * The search freshness gate reads `verifiedAt IS NULL OR verifiedAt > now() -
   * ttl`, so a NULL passes it forever: an item nobody ever checked would be
   * served as authoritative indefinitely, which is the exact opposite of what
   * the gate is for. Requiring a date at publication closes that branch.
   */
  | 'never-verified'
  | 'empty-content'
  /**
   * Published below the search floor.
   *
   * The item would exist, say "published", and never appear in a single
   * result. Refusing is kinder than a silent no-op that looks like a bug.
   */
  | 'below-confidence-floor';

export interface PublishableItem {
  sourceId: string | null;
  verifiedAt: Date | null;
  content: string;
  /** 0–100, as stored. */
  confidenceScore: number;
}

/**
 * Returns the reason to refuse publication, or `null` when it may go out.
 *
 * `minConfidence` is the module's configured floor as a fraction (0–1), the
 * same value search filters on — passed in rather than read here so the policy
 * stays free of configuration.
 */
export function refusePublication(
  item: PublishableItem,
  minConfidence: number,
): PublicationRefusal | null {
  if (!item.sourceId) return 'no-source';
  if (!item.verifiedAt) return 'never-verified';
  if (item.content.trim().length === 0) return 'empty-content';
  if (item.confidenceScore < minConfidence * 100) return 'below-confidence-floor';
  return null;
}

/**
 * The editorial lifecycle.
 *
 *   draft ⇄ review → published → review | archived → draft
 *
 * Deliberately few edges. Every extra one is a state an editor has to reason
 * about and a path the publication rules have to be checked on; the ones here
 * cover writing, approving, retiring and reviving, which is the whole job.
 */
const TRANSITIONS: Record<KnowledgeStatus, readonly KnowledgeStatus[]> = {
  draft: ['review', 'archived'],
  review: ['draft', 'published', 'archived'],
  // Back to `review` is how a published item is taken down for edits; there is
  // no direct route to `draft`, so withdrawing something is always a decision
  // someone can see in the audit trail as a single, named step.
  published: ['review', 'archived'],
  archived: ['draft'],
};

export type TransitionRefusal = 'unchanged' | 'invalid-transition';

export function refuseTransition(
  from: KnowledgeStatus,
  to: KnowledgeStatus,
): TransitionRefusal | null {
  if (from === to) return 'unchanged';
  return TRANSITIONS[from].includes(to) ? null : 'invalid-transition';
}

export const allowedTransitions = (from: KnowledgeStatus): readonly KnowledgeStatus[] =>
  TRANSITIONS[from];

/**
 * Whether the content of an item in this state may still be edited.
 *
 * Published items may not, and the reason is not procedural fussiness: the
 * item carries a verification date, and rewriting the text behind that date
 * makes it a false claim — "verified on the 3rd" would describe words nobody
 * verified. The remedy is one step (move it back to review), and the refusal
 * says so.
 */
export const isEditable = (status: KnowledgeStatus): boolean => status !== 'published';

/**
 * Whether an item's verification has lapsed.
 *
 * Mirrors the predicate search filters on, so the Back Office's "needs
 * re-verification" list cannot drift from the set of items search is quietly
 * withholding — which is the failure that would let a page look healthy while
 * the knowledge base served nothing.
 */
export function verificationExpired(
  verifiedAt: Date | null,
  ttlDays: number,
  now: Date = new Date(),
): boolean {
  if (!verifiedAt) return false;
  const ageMs = now.getTime() - verifiedAt.getTime();
  return ageMs > ttlDays * 24 * 60 * 60 * 1000;
}
