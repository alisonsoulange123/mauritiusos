import { fetchCapabilities } from './capabilities';
import { navigationFor, resolveFeatures, type ResolvedFeature } from '@/features/resolve-features';
import { clientEnv } from '@/shared/config/client-env';
import { getSession, type Session } from '@/shared/auth/session';
import { hasBackOffice } from '@/shared/admin/sections';

export interface SiteChrome {
  links: Array<{ key: string; title: string; href: string }>;
  cards: Array<{
    key: string;
    href: string;
    title: string;
    headline: string;
    body: string;
    /** Served by this deployment, but not reachable by this viewer. */
    locked: boolean;
    /**
     * Why it is locked, so the card can say something true.
     *
     * Before sessions were real, every locked card read "available once you
     * sign in" — which is wrong for a signed-in visitor whose role does not
     * cover the feature. The two cases need different words, so the reason
     * travels and the component chooses the copy.
     */
    lockedReason?: 'requires-auth' | 'role-missing';
  }>;
  /**
   * Entry-point buttons, derived in nav order from features that are actually
   * reachable. Hardcoding these was a live bug: disabling a backend module
   * left the hero pointing at a route that no longer existed.
   */
  actions: Array<{ key: string; label: string; href: string }>;
  degraded: boolean;
  /** Identity for the header's account area. Never carries a token. */
  viewer: {
    email: string;
    /**
     * Whether to offer the Back Office at all.
     *
     * Derived here from the real session rather than in the header, because
     * the header is a client component: a role list passed into one is visible
     * to the viewer. A boolean says only what the UI needs to render, and the
     * layout and the API both enforce the actual rule.
     */
    backOffice: boolean;
  } | null;
}

/**
 * Resolves the public chrome — header links, footer links, landing cards —
 * from the feature registry filtered by what the API actually serves.
 *
 * One place, so the header, the footer and the landing grid can never disagree
 * about which features exist. Both lookups are wrapped in React `cache()`, so
 * calling this from the layout and the page costs one request each, not two.
 *
 * Resolved against the REAL viewer. The public surfaces were previously fixed
 * at `authenticated: false`, which was correct while no session existed and
 * became a lie the moment one did: a signed-in visitor landing on the home page
 * would still be told to sign in to reach something already open to them.
 */
export async function getSiteChrome(): Promise<SiteChrome> {
  const [capabilities, session] = await Promise.all([
    fetchCapabilities(clientEnv.NEXT_PUBLIC_DEFAULT_TENANT),
    getSession(),
  ]);

  const resolved = resolveFeatures({
    capabilities,
    roles: session?.roles ?? [],
    authenticated: Boolean(session),
  });

  /*
   * `capabilities.degraded`, not `enabled.length === 0`. An API that answers
   * "no modules are enabled" is reporting a fact; an API that cannot be read
   * is an outage. Only the second is degraded, and only the second should make
   * the UI apologise.
   */
  return deriveChrome(resolved, capabilities.degraded, session);
}

/**
 * The pure half, split out so the invariant below can be tested without a
 * network call or a render:
 *
 *   every href this function emits points at a feature that is reachable.
 *
 * That is the property the whole capability contract exists to guarantee, and
 * it is exactly the kind of thing that silently regresses the next time
 * someone hardcodes a link into the hero.
 */
export function deriveChrome(
  resolved: ResolvedFeature[],
  degraded: boolean,
  session: Session | null = null,
): SiteChrome {
  return {
    // Navigation lists only what THIS viewer can actually open.
    links: navigationFor(resolved).map(({ key, title, href }) => ({ key, title, href })),

    /*
     * Marketing cards use a WIDER filter than navigation, and the distinction
     * matters: a feature can be live in this deployment yet be closed to this
     * viewer — anonymous, or signed in without the role.
     * Hiding it entirely would under-sell the product; linking to it would
     * produce a link that breaks the moment real auth replaces the portal's
     * placeholder session. So anything whose backend modules are enabled is
     * advertised, and `locked` decides whether it gets a link at all.
     *
     * Only 'module-disabled' removes a card — that is the deployment saying
     * the capability does not exist here.
     */
    cards: resolved
      .filter((entry) => entry.reason !== 'module-disabled' && entry.definition.marketing)
      .map((entry) => ({
        key: entry.definition.key,
        href: `/portal/${entry.definition.key}`,
        title: entry.definition.title,
        headline: entry.definition.marketing!.headline,
        body: entry.definition.marketing!.body,
        locked: !entry.visible,
        ...(entry.reason === 'requires-auth' || entry.reason === 'role-missing'
          ? { lockedReason: entry.reason }
          : {}),
      })),
    actions: resolved
      .filter((entry) => entry.visible && entry.definition.marketing?.cta)
      .sort((a, b) => (a.definition.nav?.order ?? 0) - (b.definition.nav?.order ?? 0))
      .map((entry) => ({
        key: entry.definition.key,
        label: entry.definition.marketing!.cta!,
        href: `/portal/${entry.definition.key}`,
      })),

    degraded,
    viewer: session
      ? {
          email: session.email,
          backOffice: hasBackOffice(session.roles),
        }
      : null,
  };
}
