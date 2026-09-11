import type { Role } from '@anomalia/contracts';

/**
 * Who may change whose role, to what.
 *
 * Pure and framework-free so the rules can be read and tested on their own —
 * this is the one place in the platform where a mistake hands out privilege,
 * and burying it inside a use case next to database calls would make it
 * exactly as testable as the database.
 */

/**
 * Roles carrying authority over other accounts or over published content.
 *
 * Granting any of these is an administrative act, so only an admin may do it.
 * `knowledge_manager` belongs here despite sounding editorial: it can publish
 * knowledge that the concierge then cites as verified, which is authority over
 * what the platform asserts to be true.
 */
const PRIVILEGED: readonly Role[] = ['advisor', 'knowledge_manager', 'admin'];

/**
 * The commercial ladder — the roles an advisor may move a customer along.
 *
 * `lead` is what registration issues; `client` is what unlocks the concierge.
 * Moving someone between them is routine account management, so it does not
 * need an admin, but it stops there: an advisor cannot mint another advisor.
 */
const COMMERCIAL: readonly Role[] = ['visitor', 'lead', 'client'];

export type RoleChangeRefusal =
  /** Nobody edits their own role, including admins. */
  | 'self-change'
  /** The actor holds no role that permits changing anyone's. */
  | 'not-permitted'
  /** An advisor reaching outside the commercial ladder. */
  | 'requires-admin';

export interface RoleChangeRequest {
  actorId: string;
  actorRoles: Role[];
  targetId: string;
  /** The target's current role — an advisor may not touch a privileged one. */
  from: Role;
  to: Role;
}

/**
 * Returns the reason to refuse, or `null` when the change is permitted.
 *
 * Phrased as a refusal rather than a boolean so the caller can report WHY
 * without re-deriving it, and so a new rule is added by naming a new refusal
 * instead of by extending a condition nobody can read.
 */
export function refuseRoleChange(request: RoleChangeRequest): RoleChangeRefusal | null {
  /*
   * Self-change is refused before anything else, and for admins too.
   *
   * It closes the obvious escalation (an advisor promoting themselves) and the
   * less obvious footgun: the last admin demoting themselves leaves a tenant
   * with nobody able to promote anyone, which is unrecoverable through the API.
   */
  if (request.actorId === request.targetId) return 'self-change';

  if (request.actorRoles.includes('admin')) return null;

  if (!request.actorRoles.includes('advisor')) return 'not-permitted';

  // An advisor works the commercial ladder only — and BOTH ends must be on it,
  // so they can neither create privilege nor strip it from someone who has it.
  const withinLadder =
    COMMERCIAL.includes(request.from) && COMMERCIAL.includes(request.to);

  return withinLadder ? null : 'requires-admin';
}

/** True when the role confers authority over other accounts or content. */
export const isPrivileged = (role: Role): boolean => PRIVILEGED.includes(role);
