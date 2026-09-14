import { z } from 'zod';

/**
 * THE EVENT CATALOG — the platform's asynchronous contract.
 *
 * This is the only place an event may be declared. Because the bus is typed
 * against this object, publishing an unknown event name or a mismatched
 * payload is a *compile error*, and the bus additionally validates payloads at
 * runtime so a misbehaving producer cannot poison consumers.
 *
 * Naming: `<bounded-context>.<aggregate>.<past-tense-verb>`.
 *
 * Adding an event: add a key here, nothing else. Producers and consumers
 * discover it through the type system.
 */
export const eventCatalog = {
  // ── Platform / identity ────────────────────────────────────────────────
  'platform.tenant.provisioned': z.object({
    tenantId: z.string().uuid(),
    country: z.string().length(2),
    defaultLocale: z.string(),
  }),
  'identity.user.registered': z.object({
    userId: z.string().uuid(),
    email: z.string().email(),
    locale: z.string(),
    source: z.string().optional(),
  }),
  'identity.role.changed': z.object({
    userId: z.string().uuid(),
    from: z.string(),
    to: z.string(),
    changedBy: z.string().uuid(),
  }),
  'identity.email.verified': z.object({
    userId: z.string().uuid(),
    email: z.string().email(),
  }),
  /**
   * Carries no token and no password, obviously — consumers that care are
   * reacting to the session teardown, not to the credential.
   */
  'identity.password.reset': z.object({
    userId: z.string().uuid(),
    sessionsRevoked: z.number().int().min(0),
  }),

  // ── Assessment (the conversion funnel) ─────────────────────────────────
  'assessment.started': z.object({
    assessmentId: z.string().uuid(),
    locale: z.string(),
    acquisitionSource: z.string().optional(),
  }),
  'assessment.completed': z.object({
    assessmentId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    score: z.number().min(0).max(100),
    primaryIntent: z.enum([
      'retirement',
      'investment',
      'business_setup',
      'remote_work',
      'family_relocation',
      'property_purchase',
      'lifestyle_change',
    ]),
    profileSnapshot: z.record(z.unknown()),
  }),

  // ── Immigration / decision engine ──────────────────────────────────────
  'immigration.eligibility.evaluated': z.object({
    userId: z.string().uuid(),
    permitType: z.string(),
    eligible: z.boolean(),
    confidence: z.number().min(0).max(1),
    /** Why the engine decided this — required for auditability. */
    matchedRuleIds: z.array(z.string().uuid()),
  }),

  // ── Knowledge engine ───────────────────────────────────────────────────
  'knowledge.item.published': z.object({
    knowledgeId: z.string().uuid(),
    slug: z.string(),
    category: z.string(),
    /** Triggers re-embedding in the Python AI worker. */
    requiresEmbedding: z.boolean().default(true),
  }),
  'knowledge.item.verification.expired': z.object({
    knowledgeId: z.string().uuid(),
    lastVerifiedAt: z.string().datetime(),
  }),

  // ── AI concierge (crosses the Node -> Python boundary) ─────────────────
  'ai.plan.requested': z.object({
    requestId: z.string().uuid(),
    userId: z.string().uuid(),
    goal: z.string(),
    locale: z.string(),
  }),
  'ai.plan.generated': z.object({
    requestId: z.string().uuid(),
    userId: z.string().uuid(),
    planId: z.string().uuid(),
    steps: z.array(z.object({ title: z.string(), durationLabel: z.string() })),
    confidence: z.number().min(0).max(1),
    /** Below the Human-in-the-loop threshold, an advisor must review. */
    requiresHumanReview: z.boolean(),
  }),

  // ── Relocation journey ─────────────────────────────────────────────────
  'relocation.case.created': z.object({
    caseId: z.string().uuid(),
    userId: z.string().uuid(),
    targetDate: z.string().datetime().nullable(),
  }),
  'relocation.task.completed': z.object({
    caseId: z.string().uuid(),
    taskId: z.string().uuid(),
    completionPercentage: z.number().min(0).max(100),
  }),

  // ── Documents ──────────────────────────────────────────────────────────
  'documents.document.uploaded': z.object({
    documentId: z.string().uuid(),
    userId: z.string().uuid(),
    documentType: z.string(),
    storageKey: z.string(),
  }),
  'documents.expiration.detected': z.object({
    documentId: z.string().uuid(),
    userId: z.string().uuid(),
    expiresAt: z.string().datetime(),
  }),

  // ── Canonical template module (delete once you have real modules) ──────
  'sample-feature.item.created': z.object({
    itemId: z.string().uuid(),
    title: z.string(),
    ownerId: z.string().uuid(),
  }),
} as const satisfies Record<string, z.ZodTypeAny>;

export type EventCatalog = typeof eventCatalog;
export type EventName = keyof EventCatalog;
export type EventPayload<N extends EventName> = z.infer<EventCatalog[N]>;

export const EVENT_NAMES = Object.keys(eventCatalog) as EventName[];

export const isEventName = (value: string): value is EventName =>
  Object.prototype.hasOwnProperty.call(eventCatalog, value);
