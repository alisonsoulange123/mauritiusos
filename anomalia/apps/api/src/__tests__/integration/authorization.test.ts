import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  grantRole,
  infrastructureAvailable,
  registerUser,
  startHarness,
  type Harness,
} from './harness.js';

/**
 * Who may do what, over real HTTP.
 *
 * The role policy has unit tests; these prove the policy is actually reached —
 * that `@Roles` gates the route, that the use case consults the policy, and
 * that a refusal comes back as the status and sentence the UI renders.
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

/** An account holding `role`, with a confirmed address and a live session. */
async function actor(api: Harness, email: string, role: string) {
  const created = await registerUser(api, email);
  await grantRole(api, email, role);

  // Re-authenticate: roles are baked into the access token, so the one issued
  // before the grant still says `lead`.
  const session = await api.json<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'an-integration-test-passphrase' }),
  });

  return { userId: created.userId, token: session.access_token };
}

describe('the account directory', () => {
  withApi('is open to advisors and admins, and to nobody else', async (api) => {
    const advisor = await actor(api, 'adv-dir@example.com', 'advisor');
    const admin = await actor(api, 'adm-dir@example.com', 'admin');
    const client = await actor(api, 'cli-dir@example.com', 'client');

    expect((await api.request('/auth/users?limit=1', { token: advisor.token })).status).toBe(200);
    expect((await api.request('/auth/users?limit=1', { token: admin.token })).status).toBe(200);
    expect((await api.request('/auth/users?limit=1', { token: client.token })).status).toBe(403);
    expect((await api.request('/auth/users?limit=1')).status).toBe(401);
  });

  withApi('refuses a cursor it did not issue', async (api) => {
    const admin = await actor(api, 'adm-cursor@example.com', 'admin');

    /*
     * Silently restarting would loop a client forever: it asks for the next
     * page, receives the first, and asks again with the same cursor.
     */
    const response = await api.request('/auth/users?cursor=bm9uc2Vuc2U', { token: admin.token });

    expect(response.status).toBe(400);
  });

  withApi('pages without repeating or dropping a row', async (api) => {
    const admin = await actor(api, 'adm-page@example.com', 'admin');
    for (let index = 0; index < 6; index += 1) {
      await registerUser(api, `paged-${index}@example.com`);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Array<{ id: string }>; nextCursor: string | null } = await api.json(
        `/auth/users?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        { token: admin.token },
      );
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBeGreaterThanOrEqual(7);
  });
});

describe('the audit trail', () => {
  withApi('is admin-only, advisors included', async (api) => {
    const advisor = await actor(api, 'adv-audit@example.com', 'advisor');
    const admin = await actor(api, 'adm-audit@example.com', 'admin');

    // It records what everyone in the tenant did, colleagues included.
    expect((await api.request('/audit?limit=1', { token: advisor.token })).status).toBe(403);
    expect((await api.request('/audit?limit=1', { token: admin.token })).status).toBe(200);
  });

  withApi('records a refused role change with its reason', async (api) => {
    const advisor = await actor(api, 'adv-deny@example.com', 'advisor');
    const admin = await actor(api, 'adm-deny@example.com', 'admin');
    const target = await actor(api, 'tgt-deny@example.com', 'client');

    await api.request(`/auth/users/${target.userId}/role`, {
      method: 'PATCH',
      token: advisor.token,
      body: JSON.stringify({ role: 'admin' }),
    });

    const trail = await api.json<{ items: Array<{ action: string; result: string; metadata: Record<string, string> }> }>(
      '/audit?action=identity.role.change_denied',
      { token: admin.token },
    );

    // A denied escalation is a signal, so it lands in the trail with the
    // reason rather than only as a 403 nobody sees again.
    expect(trail.items[0]?.result).toBe('denied');
    expect(trail.items[0]?.metadata.reason).toBe('requires-admin');
  });
});

describe('role changes', () => {
  withApi('lets an advisor work the commercial ladder', async (api) => {
    const advisor = await actor(api, 'adv-ok@example.com', 'advisor');
    const target = await actor(api, 'tgt-ok@example.com', 'lead');

    const result = await api.json<{ from: string; to: string; sessions_revoked: number }>(
      `/auth/users/${target.userId}/role`,
      { method: 'PATCH', token: advisor.token, body: JSON.stringify({ role: 'client' }) },
    );

    expect(result).toMatchObject({ from: 'lead', to: 'client' });
  });

  withApi('stops an advisor from minting privilege', async (api) => {
    const advisor = await actor(api, 'adv-mint@example.com', 'advisor');
    const target = await actor(api, 'tgt-mint@example.com', 'lead');

    // The escalation that matters: an advisor who can mint advisors has admin,
    // one indirection away.
    const response = await api.request(`/auth/users/${target.userId}/role`, {
      method: 'PATCH',
      token: advisor.token,
      body: JSON.stringify({ role: 'advisor' }),
    });

    expect(response.status).toBe(403);
  });

  withApi('refuses self-change, admins included', async (api) => {
    const admin = await actor(api, 'adm-self@example.com', 'admin');

    // Blocks self-promotion, and the last admin demoting themselves into a
    // tenant nobody can administer.
    const response = await api.request(`/auth/users/${admin.userId}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: JSON.stringify({ role: 'lead' }),
    });

    expect(response.status).toBe(403);
  });

  withApi('will not promote an account whose address is unconfirmed', async (api) => {
    const admin = await actor(api, 'adm-unconf@example.com', 'admin');
    const target = await registerUser(api, 'unconfirmed@example.com');

    const response = await api.request(`/auth/users/${target.userId}/role`, {
      method: 'PATCH',
      token: admin.token,
      body: JSON.stringify({ role: 'client' }),
    });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(403);
    expect(body.error.message).toMatch(/confirmed its email/i);
  });

  withApi('ends the account’s sessions so the new role applies at once', async (api) => {
    const admin = await actor(api, 'adm-revoke@example.com', 'admin');
    const target = await actor(api, 'tgt-revoke@example.com', 'lead');

    const result = await api.json<{ sessions_revoked: number }>(
      `/auth/users/${target.userId}/role`,
      { method: 'PATCH', token: admin.token, body: JSON.stringify({ role: 'client' }) },
    );

    // Roles live in the access token, so the database alone does not decide
    // what a live session may do.
    expect(result.sessions_revoked).toBeGreaterThan(0);
    expect((await api.request('/auth/me', { token: target.token })).status).toBe(401);
  });
});
