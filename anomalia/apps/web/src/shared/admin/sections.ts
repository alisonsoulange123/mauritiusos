import type { Role } from '@anomalia/contracts';

/**
 * Which parts of the Back Office a viewer may see.
 *
 * One list, derived from roles, used by the layout to decide whether to let
 * someone in at all, by the nav to decide what to draw, and by `/admin` to
 * decide where to send them. Three places that must agree; deriving them from
 * this is how they stay agreeing.
 *
 * It mirrors the `@Roles` on the endpoints behind each section, and is not the
 * security boundary — the API refuses regardless. What it prevents is the
 * worse failure of showing someone a page made entirely of 403s.
 */
export interface AdminSection {
  href: string;
  label: string;
  roles: readonly Role[];
}

const SECTIONS: readonly AdminSection[] = [
  { href: '/admin/users', label: 'Accounts', roles: ['advisor', 'admin'] },
  { href: '/admin/knowledge', label: 'Knowledge', roles: ['knowledge_manager', 'admin'] },
  { href: '/admin/audit', label: 'Audit trail', roles: ['admin'] },
];

export const sectionsFor = (roles: Role[]): AdminSection[] =>
  SECTIONS.filter((section) => section.roles.some((role) => roles.includes(role)));

/** Whether there is any back office to offer this viewer at all. */
export const hasBackOffice = (roles: Role[]): boolean => sectionsFor(roles).length > 0;

/**
 * Where to send a viewer who does not belong on the page they asked for.
 *
 * The first section they CAN see, or out of the Back Office entirely. A fixed
 * fallback was a live bug: a knowledge manager reaching `/admin/audit` was
 * redirected to the account directory, which they also cannot open, so the
 * bounce landed them on a 500 instead of somewhere useful.
 */
export const fallbackFor = (roles: Role[]): string => sectionsFor(roles)[0]?.href ?? '/portal';

export const canSee = (roles: Role[], href: string): boolean =>
  sectionsFor(roles).some((section) => href.startsWith(section.href));
