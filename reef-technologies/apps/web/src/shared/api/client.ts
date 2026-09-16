import { apiErrorSchema, type ApiError } from '@reef-technologies/contracts';
import { clientEnv } from '../config/client-env';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly traceId: string,
    readonly details?: ApiError['error']['details'],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  tenant?: string;
  /**
   * Server-side only. Browser calls authenticate by cookie through the proxy,
   * so there is no token for them to pass — and nowhere they could get one.
   */
  token?: string;
  /** Next.js cache options for server-side calls. */
  next?: { revalidate?: number; tags?: string[] };
}

/**
 * Where a request goes depends on where it runs.
 *
 * On the server, straight to the API. In the browser, to this same-origin
 * route, because the session lives in an httpOnly cookie that page scripts
 * cannot read: the proxy attaches the bearer server-side. See
 * `shared/auth/session-cookie` for why the token is out of reach at all.
 */
/*
 * Must match the route directory at `app/api/reef-technologies/` exactly.
 *
 * A rename once left this as `/api/reef_technologies` while the folder became
 * kebab-case. Every browser-side call then hit Next's own 404 page, whose body
 * is not the API error envelope — so the UI reported "the API returned 404
 * with an unrecognized body" and nothing pointed at the real cause. Server
 * rendering was unaffected, which is why the pages still loaded.
 *
 * `proxy-route.test.ts` asserts the two agree.
 */
const BROWSER_PROXY = '/api/reef-technologies';

const isServer = () => typeof window === 'undefined';

/**
 * The single fetch wrapper every feature uses.
 *
 * It exists so the platform's cross-cutting HTTP concerns are implemented
 * once: the tenant header, bearer auth, JSON handling, and — the important
 * part — decoding the API's uniform error envelope into a typed exception
 * carrying the traceId. A user can read that id off the screen and it maps
 * straight to a log line.
 *
 * Features never call `fetch` directly; if they did, each would invent its own
 * error handling and the envelope would stop being uniform.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const onServer = isServer();
  const base = onServer ? clientEnv.NEXT_PUBLIC_API_BASE_URL : BROWSER_PROXY;

  const response = await fetch(`${base}${path}`, buildInit(options, onServer));

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiRequestError(
        response.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.traceId,
        parsed.data.error.details,
      );
    }
    // A non-conforming error body means something in front of the API failed
    // (proxy, gateway). Report it as such rather than pretending it parsed.
    throw new ApiRequestError(
      response.status,
      'UNEXPECTED_RESPONSE',
      `The API returned ${response.status} with an unrecognized body.`,
      response.headers.get('x-trace-id') ?? 'unknown',
    );
  }

  return payload as T;
}

/** Split out so the routing decision and the error decoding read separately. */
function buildInit(options: RequestOptions, onServer: boolean): RequestInit {
  const { body, tenant, token, next, headers, ...rest } = options;

  return {
    ...rest,
    headers: {
      'content-type': 'application/json',
      'x-reef-technologies-tenant': tenant ?? clientEnv.NEXT_PUBLIC_DEFAULT_TENANT,
      // A token is only ever attached server-side. In the browser there is
      // none to attach, and the proxy supplies it from the httpOnly cookie.
      ...(token && onServer ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(next ? { next } : {}),
    // The proxy authenticates by cookie, so it has to be sent. Same-origin
    // only: this never travels to a third party.
    ...(onServer ? {} : { credentials: 'same-origin' as const }),
  } as RequestInit;
}
