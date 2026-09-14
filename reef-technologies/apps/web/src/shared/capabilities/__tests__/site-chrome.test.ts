import { describe, expect, it } from 'vitest';
import { deriveChrome } from '../site-chrome';
import { resolveFeatures } from '@/features/resolve-features';
import type { Capabilities } from '../capabilities';
import type { Session } from '@/shared/auth/session';
import type { Role } from '@reef-technologies/contracts';

const capabilities = (enabled: string[]): Capabilities => ({
  app: 'reef-technologies-api',
  environment: 'test',
  modules: [],
  enabled,
  // Reachable by definition in these fixtures; the degraded path is exercised
  // separately, because "read and empty" and "unreadable" are not the same.
  degraded: false,
});

const ALL = ['identity', 'knowledge', 'immigration', 'ai-concierge', 'assessment'];

/** What an anonymous visitor to the landing page sees. */
const anonymous = (enabled: string[]) =>
  deriveChrome(
    resolveFeatures({ capabilities: capabilities(enabled), roles: [], authenticated: false }),
    enabled.length === 0,
  );

/** The same surfaces, resolved for a signed-in viewer holding `roles`. */
const signedIn = (enabled: string[], roles: Role[]) => {
  // Verified: site chrome is decided by role, not by the state of the
  // mailbox, and these assertions should keep saying so.
  const session: Session = {
    userId: 'u1',
    email: 'jean@example.com',
    roles,
    emailVerified: true,
  };
  return deriveChrome(
    resolveFeatures({ capabilities: capabilities(enabled), roles, authenticated: true }),
    enabled.length === 0,
    session,
  );
};

describe('deriveChrome', () => {
  it('emits no link an anonymous visitor cannot open', () => {
    // The core invariant. Nav, entry points and unlocked cards must all point
    // at features that resolved as visible for this viewer.
    const chrome = anonymous(ALL);
    const reachable = new Set(chrome.links.map((link) => link.href));

    for (const action of chrome.actions) {
      expect(reachable).toContain(action.href);
    }
    for (const card of chrome.cards.filter((entry) => !entry.locked)) {
      expect(reachable).toContain(card.href);
    }
  });

  it('holds that invariant when modules are disabled', () => {
    // Regression guard for the hardcoded hero CTA: disabling knowledge
    // cascades to assessment and ai-concierge, leaving nothing reachable.
    const chrome = anonymous(['identity', 'immigration']);

    expect(chrome.links).toHaveLength(0);
    expect(chrome.actions).toHaveLength(0);
    expect(chrome.cards.every((card) => card.locked)).toBe(true);
  });

  it('advertises an auth-gated feature but locks it', () => {
    const chrome = anonymous(ALL);
    const concierge = chrome.cards.find((card) => card.key === 'ai-concierge');

    expect(concierge).toBeDefined();
    expect(concierge?.locked).toBe(true);
    // A locked feature is never offered as an entry point.
    expect(chrome.actions.map((action) => action.key)).not.toContain('ai-concierge');
  });

  it('drops a card entirely when its backend module is absent', () => {
    const chrome = anonymous(['identity', 'immigration', 'assessment']);
    expect(chrome.cards.map((card) => card.key)).not.toContain('knowledge-explorer');
  });

  it('orders entry points by nav order, funnel first', () => {
    const chrome = anonymous(ALL);
    expect(chrome.actions[0]?.key).toBe('assessment');
  });

  it('reports the degraded state when the API serves nothing', () => {
    const chrome = anonymous([]);
    expect(chrome.degraded).toBe(true);
    expect(chrome.actions).toHaveLength(0);
  });

  it('carries no viewer for an anonymous visitor', () => {
    expect(anonymous(ALL).viewer).toBeNull();
  });
});

describe('deriveChrome for a signed-in viewer', () => {
  it('unlocks a feature the viewer holds the role for', () => {
    const chrome = signedIn(ALL, ['client']);
    const concierge = chrome.cards.find((card) => card.key === 'ai-concierge');

    expect(concierge?.locked).toBe(false);
    // And it becomes reachable, so it may now be offered as an entry point.
    expect(chrome.links.map((link) => link.key)).toContain('ai-concierge');
  });

  it('keeps it locked — with the honest reason — for the wrong role', () => {
    /*
     * Registration issues the `lead` role, not `client`, so this is what every
     * newly created account actually sees. The card must not say "sign in":
     * they just did.
     */
    const chrome = signedIn(ALL, ['lead']);
    const concierge = chrome.cards.find((card) => card.key === 'ai-concierge');

    // Visible but locked — advertised to a lead, reachable only by a client.
    expect(concierge).toBeDefined();
    expect(concierge?.locked).toBe(true);
    expect(concierge?.lockedReason).toBe('role-missing');
    // And never offered as an entry point, which would be a dead link.
    expect(chrome.actions.map((action) => action.key)).not.toContain('ai-concierge');
    expect(chrome.links.map((link) => link.key)).not.toContain('ai-concierge');
  });

  it('labels an anonymous lock as requiring sign-in', () => {
    const concierge = anonymous(ALL).cards.find((card) => card.key === 'ai-concierge');
    expect(concierge?.lockedReason).toBe('requires-auth');
  });

  it('holds the no-dead-link invariant for a signed-in viewer too', () => {
    const chrome = signedIn(ALL, ['client']);
    const reachable = new Set(chrome.links.map((link) => link.href));

    for (const action of chrome.actions) {
      expect(reachable).toContain(action.href);
    }
    for (const card of chrome.cards.filter((entry) => !entry.locked)) {
      expect(reachable).toContain(card.href);
    }
  });

  it('exposes the viewer identity, and only the identity', () => {
    const chrome = signedIn(ALL, ['client']);

    // `backOffice` is a decision, not a credential: it says what to render and
    // reveals nothing the viewer does not already know about themselves.
    expect(chrome.viewer).toEqual({ email: 'jean@example.com', backOffice: false });
    // A token reaching this object would be serialised into the HTML by the
    // header, which is the leak the httpOnly cookie exists to prevent.
    expect(JSON.stringify(chrome)).not.toContain('token');
  });

  it('offers the back office to everyone who has a section in it', () => {
    // Advisors get the account directory, knowledge managers the knowledge
    // base, admins both plus the audit trail. The link is offered whenever
    // there is at least one section to land on.
    for (const role of ['advisor', 'knowledge_manager', 'admin'] as Role[]) {
      expect(signedIn(ALL, [role]).viewer?.backOffice).toBe(true);
    }

    // Everyone else must not even be offered the door. The layout and every
    // endpoint behind it refuse them anyway, but a link that always fails is
    // a support ticket.
    for (const role of ['visitor', 'lead', 'client', 'partner'] as Role[]) {
      expect(signedIn(ALL, [role]).viewer?.backOffice).toBe(false);
    }
  });

  it('never emits a back office link for an anonymous visitor', () => {
    expect(anonymous(ALL).viewer).toBeNull();
  });
});

describe('degraded reporting', () => {
  /*
   * Regression guard for a live failure: the capability endpoint was rate
   * limited, `fetchCapabilities` treated any non-OK response as "no modules
   * exist", and the site silently presented itself as having no features —
   * empty nav, empty grid, "Platform services unavailable" in the footer.
   *
   * The two states must stay distinguishable here, because everything the
   * visitor sees is derived from this function.
   */
  it('separates "serves nothing" from "could not be read"', () => {
    const servesNothing = deriveChrome(
      resolveFeatures({ capabilities: capabilities([]), roles: [], authenticated: false }),
      false,
    );
    const unreachable = deriveChrome(
      resolveFeatures({ capabilities: capabilities([]), roles: [], authenticated: false }),
      true,
    );

    expect(servesNothing.degraded).toBe(false);
    expect(unreachable.degraded).toBe(true);
  });

  it('keeps features reachable when a stale snapshot is served', () => {
    // What a last-known-good fallback produces: modules still listed, but the
    // read flagged as degraded. Navigation must survive, not empty out.
    const chrome = deriveChrome(
      resolveFeatures({ capabilities: capabilities(ALL), roles: [], authenticated: false }),
      true,
    );

    expect(chrome.degraded).toBe(true);
    expect(chrome.links.length).toBeGreaterThan(0);
    expect(chrome.actions.length).toBeGreaterThan(0);
  });
});
