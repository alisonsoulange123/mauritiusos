/**
 * The canonical module identifiers of the platform.
 *
 * Backend module directories, frontend feature gating and the capability
 * endpoint all key off this list, so a module can never be referred to by two
 * different names in two different places.
 *
 * Domain names come from the DDD blueprint's bounded contexts.
 */
export const MODULE_KEYS = [
  'sample-feature',
  'identity',
  'assessment',
  'knowledge',
  'immigration',
  'relocation',
  'property',
  'finance',
  'marketplace',
  'documents',
  'ai-concierge',
  'analytics',
  'billing',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const isModuleKey = (value: string): value is ModuleKey =>
  (MODULE_KEYS as readonly string[]).includes(value);

/** Coarse roles from the Security blueprint's RBAC matrix. */
export const ROLES = ['visitor', 'lead', 'client', 'advisor', 'knowledge_manager', 'partner', 'admin'] as const;
export type Role = (typeof ROLES)[number];
