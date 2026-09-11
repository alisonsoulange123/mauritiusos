/**
 * Constrains a post-authentication redirect to this site.
 *
 * The target arrives in a query string, so without this `/login?next=https://
 * evil.example` would bounce a visitor off-site at the exact moment they have
 * just typed a password and are primed to trust the next screen. That is the
 * classic open redirect, and sign-in is where it does the most damage.
 *
 * Allowed: a path starting with a single `/`. Everything else falls back.
 *
 * The `//` rejection is the one that is easy to miss — `//evil.example` is a
 * protocol-relative URL, so it passes a naive "starts with a slash" check and
 * still leaves the site. Backslashes are rejected for the same reason: some
 * agents normalise `/\evil.example` to a network path.
 */
export const DEFAULT_DESTINATION = '/portal';

export function safeRedirect(target: string | undefined | null): string {
  if (!target) return DEFAULT_DESTINATION;
  if (!target.startsWith('/')) return DEFAULT_DESTINATION;
  if (target.startsWith('//') || target.startsWith('/\\')) return DEFAULT_DESTINATION;
  return target;
}
