import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  grantRole,
  infrastructureAvailable,
  registerUser,
  startHarness,
  type Harness,
} from './harness.js';

/**
 * Account recovery and editorial publication, over real HTTP.
 *
 * Both are flows whose whole value is in what they REFUSE — an enumerable
 * forgot-password form and an unsourced published fact are the failures they
 * exist to prevent — and a refusal is exactly the kind of behaviour that
 * regresses silently.
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

async function editor(api: Harness, email: string) {
  await registerUser(api, email);
  await grantRole(api, email, 'knowledge_manager');
  const session = await api.json<{ access_token: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'an-integration-test-passphrase' }),
  });
  return session.access_token;
}

describe('forgot password', () => {
  withApi('answers a registered and an unknown address identically', async (api) => {
    await registerUser(api, 'known@example.com');

    const known = await api.request('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: 'known@example.com' }),
    });
    const unknown = await api.request('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: 'never-registered@example.com' }),
    });

    // Anything else turns this form into a way to test a breach dump against
    // the customer list.
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(await known.json()).toEqual(await unknown.json());
  });

  withApi('records the unknown attempt as denied', async (api) => {
    await registerUser(api, 'audited@example.com');
    await grantRole(api, 'audited@example.com', 'admin');
    const session = await api.json<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'audited@example.com', password: 'an-integration-test-passphrase' }),
    });

    await api.request('/auth/password/forgot', {
      method: 'POST',
      body: JSON.stringify({ email: 'still-nobody@example.com' }),
    });

    const trail = await api.json<{ items: Array<{ result: string; metadata: Record<string, string> }> }>(
      '/audit?action=identity.password.reset_requested&result=denied',
      { token: session.access_token },
    );

    // Invisible to the attacker, visible to operators: a burst of these is the
    // shape of an enumeration attempt.
    expect(trail.items[0]?.metadata.email).toBe('still-nobody@example.com');
  });
});

describe('reset links', () => {
  withApi('refuses one it never issued', async (api) => {
    const response = await api.request('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token: 'not-a-real-token', password: 'a-brand-new-passphrase' }),
    });

    expect(response.status).toBe(410);
  });

  withApi('rejects a short password without spending the link', async (api) => {
    // Validation runs before the single-use token is consumed, so a typo does
    // not cost the user their link and another trip to their mailbox.
    const response = await api.request('/auth/password/reset', {
      method: 'POST',
      body: JSON.stringify({ token: 'whatever', password: 'short' }),
    });

    expect(response.status).toBe(422);
  });
});

describe('email confirmation', () => {
  withApi('refuses a confirmation link it never issued', async (api) => {
    const response = await api.request('/auth/email/verify', {
      method: 'POST',
      body: JSON.stringify({ token: 'not-a-real-token' }),
    });

    // One message for expired, already-used, unknown and malformed alike.
    expect(response.status).toBe(410);
  });

  withApi('will not resend to an address someone else names', async (api) => {
    // The endpoint is authenticated and always mails the account on the token:
    // a public resend taking an email would let anyone have the platform mail
    // anyone, and would confirm which addresses exist while doing it.
    expect((await api.request('/auth/email/verification', { method: 'POST' })).status).toBe(401);
  });
});

describe('publication', () => {
  withApi('is refused without a source, then without verification', async (api) => {
    const token = await editor(api, 'editor-rules@example.com');

    const draft = await api.json<{ id: string }>('/knowledge', {
      method: 'POST',
      token,
      body: JSON.stringify({
        title: 'Occupation permit for investors',
        type: 'RULE',
        category: 'immigration',
        content: 'An investor may apply where the transfer meets the qualifying threshold.',
      }),
    });

    // Straight to published is not a path: publication is an approval, so it
    // is approached from review.
    const direct = await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'published' }),
    });
    expect(direct.status).toBe(409);

    await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'review' }),
    });

    const unsourced = await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'published' }),
    });
    const unsourcedBody = (await unsourced.json()) as { error: { message: string } };
    // The module's central claim, enforced rather than asserted in a comment.
    expect(unsourced.status).toBe(409);
    expect(unsourcedBody.error.message).toMatch(/needs a source/i);

    const source = await api.json<{ id: string }>('/knowledge/sources', {
      method: 'POST',
      token,
      body: JSON.stringify({
        name: 'Economic Development Board',
        sourceType: 'government',
        authorityLevel: 'official',
      }),
    });
    await api.request(`/knowledge/${draft.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ sourceId: source.id }),
    });

    const unverified = await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'published' }),
    });
    const unverifiedBody = (await unverified.json()) as { error: { message: string } };
    // A NULL verification date passes the search freshness gate forever, so an
    // item nobody checked would be served as authoritative indefinitely.
    expect(unverified.status).toBe(409);
    expect(unverifiedBody.error.message).toMatch(/never been verified/i);

    await api.request(`/knowledge/${draft.id}/verify`, {
      method: 'POST',
      token,
      body: JSON.stringify({ confidenceScore: 95 }),
    });

    const published = await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'published' }),
    });
    expect(published.status).toBe(200);
  });

  withApi('freezes the text of a published item', async (api) => {
    const token = await editor(api, 'editor-freeze@example.com');
    const source = await api.json<{ id: string }>('/knowledge/sources', {
      method: 'POST',
      token,
      body: JSON.stringify({ name: 'Registrar', sourceType: 'government', authorityLevel: 'official' }),
    });
    const draft = await api.json<{ id: string }>('/knowledge', {
      method: 'POST',
      token,
      body: JSON.stringify({
        title: 'Company formation',
        type: 'GUIDE',
        category: 'business',
        content: 'A company may be formed by a non-citizen.',
        sourceId: source.id,
        confidenceScore: 90,
      }),
    });
    await api.request(`/knowledge/${draft.id}/verify`, { method: 'POST', token, body: '{}' });
    await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'review' }),
    });
    await api.request(`/knowledge/${draft.id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status: 'published' }),
    });

    const edit = await api.request(`/knowledge/${draft.id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ content: 'Quietly rewritten after verification.' }),
    });

    // The item carries a verification date; rewriting the words behind it
    // would make that date describe a paragraph nobody verified.
    expect(edit.status).toBe(409);
  });

  withApi('keeps the authoring surface away from customers', async (api) => {
    await registerUser(api, 'customer-knowledge@example.com');
    await grantRole(api, 'customer-knowledge@example.com', 'client');
    const session = await api.json<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'customer-knowledge@example.com', password: 'an-integration-test-passphrase' }),
    });

    expect((await api.request('/knowledge?limit=1', { token: session.access_token })).status).toBe(403);
    // …while public search stays open: the explorer is an acquisition surface.
    expect((await api.request('/knowledge/search?q=permit')).status).toBe(200);
  });
});
