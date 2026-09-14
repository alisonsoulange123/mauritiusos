/**
 * CSRF check for the API proxy.
 *
 * The proxy authenticates by cookie, and browsers attach cookies to
 * cross-site requests too — so without this, a form on any other origin could
 * POST to `/api/reef-technologies/*` and act as the signed-in user. The session cookie
 * is `sameSite: 'lax'`, which already withholds it from cross-site POSTs; this
 * is the second lock, because a single control that fails silently is not a
 * control.
 *
 * A missing `Origin` is rejected on unsafe methods rather than waved through:
 * a same-origin `fetch` always sends one on a POST, so its absence means the
 * caller is not the thing this proxy exists to serve.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    // Not a parseable URL — "null" from a sandboxed frame, or junk.
    return false;
  }
}
