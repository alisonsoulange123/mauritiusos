import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  infrastructureAvailable,
  registerUser,
  startHarness,
  type Harness,
} from './harness.js';

/**
 * The session claims, over real HTTP.
 *
 * Each of these was verified once by hand with curl. That proved the code was
 * right on the afternoon it was written and nothing since.
 */
let harness: Harness | null = null;

beforeAll(async () => {
  if (await infrastructureAvailable()) harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

const withApi = (name: string, body: (api: Harness) => Promise<void>) =>
  it(name, async (ctx) => {
    if (!harness) ctx.skip();
    await body(harness as Harness);
  });

describe('registration and sign-in', () => {
  withApi('issues a session for correct credentials', async (api) => {
    const { accessToken } = await registerUser(api, 'alice@example.com');

    const me = await api.json<{ email: string; roles: string[]; email_verified: boolean }>(
      '/auth/me',
      { token: accessToken },
    );

    expect(me.email).toBe('alice@example.com');
    // Registration issues `lead`, and the address is unconfirmed until clicked.
    expect(me.roles).toEqual(['lead']);
    expect(me.email_verified).toBe(false);
  });

  withApi('refuses a wrong password and an unknown account identically', async (api) => {
    await registerUser(api, 'bob@example.com');

    const wrongPassword = await api.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'bob@example.com', password: 'not-the-password' }),
    });
    const unknownAccount = await api.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'nobody@example.com', password: 'not-the-password' }),
    });

    // Same status and same message: distinguishing them turns sign-in into an
    // account-enumeration oracle. The trace id differs per request by design,
    // so it is the one field excluded from the comparison.
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);

    const [a, b] = await Promise.all([wrongPassword.json(), unknownAccount.json()]);
    expect(withoutTrace(a)).toEqual(withoutTrace(b));
  });

  withApi('rejects an anonymous request to a guarded route', async (api) => {
    // Deny-by-default: the guard is global, so a route is protected unless
    // someone writes @Public().
    expect((await api.request('/auth/me')).status).toBe(401);
  });
});

describe('token type confusion', () => {
  withApi('refuses a refresh token presented as a bearer', async (api) => {
    const { refreshToken } = await registerUser(api, 'carol@example.com');

    /*
     * A live bug once. Both tokens are signed with the same key, so without the
     * `typ` claim the guard accepted a refresh token as an access token — and a
     * refresh token lives thirty days, not fifteen minutes. It also reached
     * `claims.roles.filter` on an absent claim and answered 500.
     */
    const response = await api.request('/auth/me', { token: refreshToken });

    expect(response.status).toBe(401);
  });
});

describe('refresh rotation', () => {
  withApi('retires the token it was given', async (api) => {
    const { refreshToken } = await registerUser(api, 'dan@example.com');

    const rotated = await api.json<{ refresh_token: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    expect(rotated.refresh_token).not.toBe(refreshToken);
  });

  withApi('treats a genuine replay as compromise and ends every session', async (api) => {
    const { refreshToken, accessToken } = await registerUser(api, 'erin@example.com');

    // Rotate once, so the original is retired.
    const rotated = await api.json<{ refresh_token: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    // Outside the grace window, the retired token coming back is not a racing
    // tab. Two parties hold the same credential and one of them is not the user.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const replay = await api.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(replay.status).toBe(401);

    // The response is to revoke everything — including the token the attacker
    // installed, and the victim's still-valid access token. Revocation that
    // only stopped the next refresh would leave a working session behind.
    const victimRefresh = await api.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: rotated.refresh_token }),
    });
    expect(victimRefresh.status).toBe(401);
    expect((await api.request('/auth/me', { token: accessToken })).status).toBe(401);
  });

  withApi('does not mistake concurrent refreshes for an attack', async (api) => {
    const { refreshToken } = await registerUser(api, 'frank@example.com');

    // A page load can fire several requests carrying the same expired cookie.
    // Without a grace window each arrival after the first looks like a replay,
    // and an ordinary page load would trigger a security logout.
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.request('/auth/refresh', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: refreshToken }),
        }),
      ),
    );

    expect(outcomes.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
  });
});

describe('sign-out', () => {
  withApi('ends the lineage server-side, not just in the browser', async (api) => {
    const { refreshToken } = await registerUser(api, 'grace@example.com');

    const out = await api.request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(out.status).toBe(204);

    // Deleting a cookie removes one browser's copy; the token itself would
    // otherwise stay valid for thirty days, which on a shared machine makes
    // signing out close to meaningless.
    const afterwards = await api.request('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    expect(afterwards.status).toBe(401);
  });
});

describe('tenancy', () => {
  withApi('refuses a token minted for another tenant', async (api) => {
    const { accessToken } = await registerUser(api, 'heidi@example.com');

    /*
     * Presented against a DIFFERENT REAL tenant. It has to exist: an
     * unresolvable slug is refused as 400 by the tenancy middleware before
     * authorization is consulted, which would pass this test without proving
     * anything about isolation.
     */
    const response = await api.request('/auth/me', {
      token: accessToken,
      tenant: api.otherTenant,
    });

    expect([401, 403]).toContain(response.status);
  });
});

/** The trace id is unique per request by design; everything else must match. */
const withoutTrace = (body: unknown): unknown => {
  const { traceId, ...rest } = body as { traceId?: string };
  void traceId;
  return rest;
};
