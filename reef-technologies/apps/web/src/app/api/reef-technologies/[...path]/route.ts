import { NextResponse, type NextRequest } from 'next/server';
import { clientEnv } from '@/shared/config/client-env';
import { readAccessToken } from '@/shared/auth/session';
import { isSameOrigin } from '@/shared/auth/same-origin';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  THE AUTHENTICATING PROXY.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Browser code cannot attach a bearer token, because the session cookie is
 * httpOnly and script cannot read it. So feature screens call this same-origin
 * route instead; the cookie rides along automatically, and the token is added
 * here, on the server, on its way to the API.
 *
 * The property that buys: there is no point in the browser where an XSS could
 * read the session. Not a variable, not a store, not a header it constructed.
 *
 * It also removes the browser's direct dependency on the API origin, so CORS
 * stops being load-bearing for the app's own traffic.
 */

/** Header names that must come from here, not from the caller. */
const STRIPPED = new Set(['host', 'cookie', 'authorization', 'content-length', 'connection']);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Reads only; state-changing methods must prove they came from this origin. */
const originAllowed = (request: NextRequest): boolean =>
  SAFE_METHODS.has(request.method) ||
  isSameOrigin(request.headers.get('origin'), request.headers.get('host'));

async function forward(request: NextRequest, segments: string[]): Promise<Response> {
  if (!originAllowed(request)) {
    return NextResponse.json(
      { error: { code: 'CSRF_REJECTED', message: 'Cross-origin request rejected.' }, traceId: 'proxy' },
      { status: 403 },
    );
  }

  const target = new URL(
    `${clientEnv.NEXT_PUBLIC_API_BASE_URL}/${segments.join('/')}`,
  );
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIPPED.has(key.toLowerCase())) headers.set(key, value);
  });

  // The tenant is a deployment fact, not something a caller may choose: without
  // this the browser could ask for another tenant's data and rely on the API to
  // say no. The API does say no — it also should not be asked.
  headers.set('x-reef-technologies-tenant', clientEnv.NEXT_PUBLIC_DEFAULT_TENANT);

  const token = await readAccessToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const body = SAFE_METHODS.has(request.method) ? undefined : await request.text();

  const response = await fetch(target, {
    method: request.method,
    headers,
    ...(body ? { body } : {}),
    cache: 'no-store',
  }).catch(() => null);

  if (!response) {
    return NextResponse.json(
      { error: { code: 'UPSTREAM_UNREACHABLE', message: 'The service is unavailable.' }, traceId: 'proxy' },
      { status: 502 },
    );
  }

  // Pass the API's own envelope through untouched — the trace id in an error
  // body is the thread back to a log line, and rewriting it here would break
  // that. Only hop-by-hop headers are dropped.
  const passthrough = new Headers();
  const contentType = response.headers.get('content-type');
  if (contentType) passthrough.set('content-type', contentType);
  const traceId = response.headers.get('x-trace-id');
  if (traceId) passthrough.set('x-trace-id', traceId);

  return new Response(await response.text(), { status: response.status, headers: passthrough });
}

type Context = { params: Promise<{ path: string[] }> };

const handler = async (request: NextRequest, context: Context) =>
  forward(request, (await context.params).path);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;

/** Never cached: every response here is scoped to one session. */
export const dynamic = 'force-dynamic';
