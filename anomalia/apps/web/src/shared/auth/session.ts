import { cache } from 'react';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { ROLES, type Role } from '@anomalia/contracts';
import { clientEnv } from '../config/client-env';
import { SESSION_COOKIE } from './session-cookie';

/**
 * Importing `next/headers` makes this module server-only: pulling it into a
 * client component is a build error, not a runtime leak.
 */

const actorSchema = z.object({
  id: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
});

export interface Session {
  userId: string;
  email: string;
  roles: Role[];
}

/**
 * Reads the raw access token. The ONLY caller should be the API proxy.
 *
 * Kept separate from `getSession` so the token is never part of the object
 * that layouts and pages pass around — a `Session` handed to a client
 * component serialises into the HTML, and a token in that shape would be
 * exactly the leak the httpOnly cookie exists to prevent.
 */
export async function readAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Who is asking, according to the API.
 *
 * Verified by calling `/auth/me` rather than checking the JWT signature here.
 * Verifying locally would need `JWT_SECRET` in the web deployment, putting the
 * signing key in two places and making a frontend compromise a token-minting
 * compromise. It would also keep a suspended account signed in until its token
 * expired, because a signature stays valid after the user behind it does not.
 *
 * The cost is one request per render pass — `cache()` dedupes it, so a layout
 * and its page share a single call.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = await readAccessToken();
  if (!token) return null;

  try {
    const response = await fetch(`${clientEnv.NEXT_PUBLIC_API_BASE_URL}/auth/me`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-anomalia-tenant': clientEnv.NEXT_PUBLIC_DEFAULT_TENANT,
      },
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const parsed = actorSchema.safeParse(await response.json());
    if (!parsed.success) return null;

    return {
      userId: parsed.data.id,
      email: parsed.data.email,
      // Drop anything the contract does not name. An unrecognised role must
      // not widen access by surviving into the resolver as an opaque string.
      roles: parsed.data.roles.filter((role): role is Role =>
        (ROLES as readonly string[]).includes(role),
      ),
    };
  } catch {
    // An unreachable API means "not signed in", never a crashed page. The
    // capability layer degrades the same way for the same reason.
    return null;
  }
});
