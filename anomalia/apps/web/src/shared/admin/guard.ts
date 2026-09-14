import { redirect } from 'next/navigation';
import { getSession, type Session } from '../auth/session';
import { canSee, fallbackFor } from './sections';

/**
 * Admits a viewer to one section of the Back Office.
 *
 * The layout answers "may you be in here at all"; this answers "may you be on
 * THIS page", and both are needed. Relying on the layout alone was a live bug:
 * a knowledge manager is legitimately inside the Back Office, so the layout
 * let them through to the account directory, where the page's own API call
 * came back 403 and rendered a 500. A redirect is the honest response — they
 * are not broken, they are simply somewhere they do not belong.
 *
 * None of this is the security boundary. Every endpoint behind these pages
 * carries its own `@Roles`, and this changes nothing about what the API will
 * answer; it decides what a person sees instead of a stack trace.
 */
export async function requireSection(href: string): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(`/login?next=${href}`);

  if (!canSee(session.roles, href)) redirect(fallbackFor(session.roles));
  return session;
}
