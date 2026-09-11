import { NextResponse, type NextRequest } from 'next/server';
import { clientEnv } from '@/shared/config/client-env';
import {
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/shared/auth/session-cookie';

/**
 * Silent refresh.
 *
 * The access token lasts 15 minutes, which is short on purpose — it is the
 * credential actually sent to the API. Without this, a visitor part-way
 * through an assessment would be signed out mid-form.
 *
 * It has to happen here because of a Next.js constraint, not a preference:
 * only middleware, route handlers and server actions may set cookies. A server
 * component can read a session but cannot renew one, so the layout is the
 * wrong place to notice the token has lapsed.
 *
 * Cheap by construction: the refresh call runs only when the access cookie is
 * gone and a refresh cookie remains, which is roughly once every fifteen
 * minutes per session, not once per request.
 */
export async function middleware(request: NextRequest) {
  const hasAccess = request.cookies.has(SESSION_COOKIE);
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (hasAccess || !refreshToken) return NextResponse.next();

  const outcome = await renew(refreshToken);

  if (outcome.status === 'rejected') {
    /*
     * Spent, revoked, or the account suspended — including the case that
     * matters most: reuse was detected on this lineage and the API revoked
     * every session on the account. Clear BOTH cookies so the browser holds
     * nothing from a session that no longer exists, and the next request is a
     * clean anonymous one rather than a failed refresh repeated on every
     * navigation.
     */
    const response = NextResponse.next();
    response.cookies.delete(REFRESH_COOKIE);
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  // An unreachable API is not a rejected session. Keeping the cookie means a
  // transient outage costs the visitor a page, not their sign-in.
  if (outcome.status === 'unreachable') return NextResponse.next();

  const renewed = outcome.session;

  // Seed the INCOMING request too. Without this the render this request is
  // about to perform still sees no session, so the visitor gets one signed-out
  // page before the new cookie takes effect on the next navigation.
  request.cookies.set(SESSION_COOKIE, renewed.access_token);

  const response = NextResponse.next({ request });
  response.cookies.set(SESSION_COOKIE, renewed.access_token, sessionCookieOptions(renewed.expires_in));
  response.cookies.set(REFRESH_COOKIE, renewed.refresh_token, sessionCookieOptions(REFRESH_MAX_AGE_SECONDS));
  return response;
}

interface RenewedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * The three outcomes are kept distinct because the caller must treat them
 * differently: only a REJECTED token should be discarded. Collapsing
 * "unreachable" into "rejected" would turn a brief API outage into a mass
 * sign-out, with every session having to log in again afterwards.
 */
type RenewResult =
  | { status: 'renewed'; session: RenewedSession }
  | { status: 'rejected' }
  | { status: 'unreachable' };

async function renew(refreshToken: string): Promise<RenewResult> {
  let response: Response;
  try {
    response = await fetch(`${clientEnv.NEXT_PUBLIC_API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-anomalia-tenant': clientEnv.NEXT_PUBLIC_DEFAULT_TENANT,
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    });
  } catch {
    return { status: 'unreachable' };
  }

  // 5xx is the API failing, not the token being refused. 429 likewise: the
  // credential endpoints are rate limited, and being throttled must not cost
  // a valid session.
  if (response.status >= 500 || response.status === 429) return { status: 'unreachable' };
  if (!response.ok) return { status: 'rejected' };

  const payload = (await response.json().catch(() => null)) as Partial<RenewedSession> | null;
  if (!payload?.access_token || !payload.refresh_token || !payload.expires_in) {
    return { status: 'unreachable' };
  }
  return { status: 'renewed', session: payload as RenewedSession };
}

export const config = {
  /**
   * Everything except static output. Asset requests carry cookies but never
   * need a session, and refreshing on them would multiply the work by the
   * number of files on a page.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
