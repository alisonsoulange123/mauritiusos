import { cache } from 'react';
import { z } from 'zod';
import { clientEnv } from '../config/client-env';

/**
 * Reads the API's self-description.
 *
 * This is the contract that makes the frontend plug-and-play: the backend is
 * the authority on which modules exist, and the UI adapts. Hardcoding a list
 * here would guarantee drift the first time someone flips a flag in staging.
 */
const capabilitiesSchema = z.object({
  app: z.string(),
  environment: z.string(),
  modules: z.array(
    z.object({
      key: z.string(),
      version: z.string(),
      enabled: z.boolean(),
      stability: z.enum(['experimental', 'beta', 'stable']),
      description: z.string(),
    }),
  ),
  enabled: z.array(z.string()),
});

export type Capabilities = z.infer<typeof capabilitiesSchema> & {
  /**
   * True only when the API could not be read at all.
   *
   * Distinct from `enabled: []`, and the distinction is the whole point: a
   * deployment that genuinely serves no modules is a fact to render, while an
   * unreachable API is an outage to survive. Collapsing the two meant one
   * failed request presented the product as having no features.
   */
  degraded: boolean;
};

/** Used only before any successful read — the honest "we know nothing" state. */
const UNKNOWN: Capabilities = {
  app: 'anomalia-api',
  environment: 'unknown',
  modules: [],
  enabled: [],
  degraded: true,
};

/**
 * Last-known-good, held in server memory across requests.
 *
 * Without it, any transient failure — a restart, a timeout, a rate-limit —
 * empties the navigation, the landing grid and the footer simultaneously, and
 * tells the visitor the platform has nothing to offer. That is a far worse
 * outcome than briefly serving a slightly stale module list, because the
 * module list changes on deploys and the outage lasts seconds.
 */
let lastKnownGood: Capabilities | null = null;

/**
 * Read per request, and never from the build.
 *
 * The short `revalidate` is deliberate on both sides. Long enough that a burst
 * of page renders collapses into one upstream call — this endpoint is asked on
 * EVERY render, it returns the same deployment metadata for every visitor, and
 * it is rate limited, so per-render fetching is what pushed it into 429s in the
 * first place. Short enough that flipping a backend flag still reaches the UI
 * within seconds, with no frontend rebuild or restart, which is the property
 * the capability contract exists to provide.
 *
 * Note the propagation shape: Next revalidates stale-while-revalidate, so the
 * first request after the window still renders the OLD value and triggers the
 * refresh behind it. A flag change therefore lands on the second request, not
 * the first — which looks like a bug when you flip a flag and reload once.
 *
 * It must never be baked at BUILD time — that would freeze the module list
 * into the output — which is why every page reading this also sets
 * `export const dynamic = 'force-dynamic'`.
 *
 * React's `cache()` deduplicates within a single render pass, so a layout and
 * its page share one lookup rather than making two.
 */
export const fetchCapabilities = cache(async (tenant: string): Promise<Capabilities> => {
  try {
    const response = await fetch(`${clientEnv.NEXT_PUBLIC_API_BASE_URL}/_platform/capabilities`, {
      headers: { 'x-anomalia-tenant': tenant },
      next: { revalidate: 10, tags: ['capabilities'] },
    });
    if (!response.ok) return degrade();

    const parsed = capabilitiesSchema.safeParse(await response.json());
    if (!parsed.success) return degrade();

    lastKnownGood = { ...parsed.data, degraded: false };
    return lastKnownGood;
  } catch {
    // Never let a capability lookup break the page.
    return degrade();
  }
});

/**
 * Serve the previous answer rather than asserting emptiness.
 *
 * Still flagged `degraded`, so the UI can say so — but the features stay
 * visible and reachable, because the API being briefly unreadable is not
 * evidence that its modules went away.
 */
const degrade = (): Capabilities =>
  lastKnownGood ? { ...lastKnownGood, degraded: true } : UNKNOWN;
