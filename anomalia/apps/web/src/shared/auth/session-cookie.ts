/**
 * ════════════════════════════════════════════════════════════════════════════
 *  WHERE THE SESSION LIVES — and why it is not in JavaScript.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Two constraints pull in opposite directions here.
 *
 * The portal gates on the SERVER: `/portal/[feature]` resolves the registry
 * against the viewer's roles before it will even send a feature's code. So the
 * server has to know who is asking, which rules out `localStorage` — invisible
 * to a server component.
 *
 * The token is also the whole account: with the API's Zero-Trust guard, anyone
 * holding it is the user. So it must not be readable by page scripts, which
 * rules out a plain cookie.
 *
 * The intersection is an httpOnly cookie. The server reads it; script cannot.
 * That leaves browser code with no way to attach a bearer header, which is why
 * `shared/api/client` routes browser calls through a same-origin proxy that
 * attaches it server-side. The token never enters the JS heap on any surface.
 *
 * The pair is split by lifetime, which is the point of having two:
 *
 *   access  — 15 minutes, sent to the API on every call.
 *   refresh — 30 days, sent ONLY to `/auth/refresh`, by middleware.
 *
 * A stolen access token is useful for minutes. The refresh token is never
 * exposed to a page, an API call, or a log.
 */

export const SESSION_COOKIE = 'anomalia_session';
export const REFRESH_COOKIE = 'anomalia_refresh';

/**
 * `sameSite: 'lax'` is a CSRF control, not a default.
 *
 * The proxy authenticates by cookie, so without it any site could POST to
 * `/api/anomalia/*` and have the browser attach this session. Lax withholds
 * the cookie from cross-site POSTs while keeping it on top-level navigations,
 * so following a link back into the app still arrives signed in. The proxy
 * checks `Origin` as well — one control failing quietly should not be enough.
 */
export const sessionCookieOptions = (maxAge: number) =>
  ({
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  }) as const;

/**
 * Refresh cookies are scoped to 30 days regardless of the access TTL.
 *
 * Kept a shade under the API's own refresh expiry so the browser discards it
 * fractionally before the server would reject it — an expired cookie that is
 * simply absent produces a clean sign-in, where a present-but-rejected one
 * produces a failed refresh on every request until it lapses.
 */
export const REFRESH_MAX_AGE_SECONDS = 60 * 60 * 24 * 29;
