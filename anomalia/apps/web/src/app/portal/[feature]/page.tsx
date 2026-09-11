import { notFound, redirect } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import { findFeature } from '@/features/registry';
import { resolveFeatures } from '@/features/resolve-features';
import { fetchCapabilities } from '@/shared/capabilities/capabilities';
import { getSession } from '@/shared/auth/session';
import { clientEnv } from '@/shared/config/client-env';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ONE ROUTE FOR EVERY FEATURE.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * The dynamic segment is resolved against the registry, which is why adding a
 * feature needs no route file, no `app/` directory and no edit here. There is
 * no route table to keep in sync because there is no route table.
 *
 * Gating happens on the SERVER, before any feature code is sent. A feature the
 * viewer may not see 404s rather than rendering an empty shell, and its
 * JavaScript is never downloaded — the `mount()` dynamic import is only
 * reached after the check passes.
 */
/**
 * Rendered per request.
 *
 * Static generation would freeze the capability check at build time: a feature
 * whose backend module was disabled during `next build` would stay 404 even
 * after the module was enabled. Gating is a deployment-time fact, so the page
 * has to ask on every request.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const definition = findFeature(feature);
  return definition
    ? { title: `${definition.title} · ANOMALIA`, description: definition.description }
    : { title: 'Not found · ANOMALIA' };
}

export default async function FeaturePage({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const definition = findFeature(feature);
  if (!definition) notFound();

  const tenant = clientEnv.NEXT_PUBLIC_DEFAULT_TENANT;
  const [capabilities, session] = await Promise.all([fetchCapabilities(tenant), getSession()]);

  const resolved = resolveFeatures({
    capabilities,
    roles: session?.roles ?? [],
    authenticated: Boolean(session),
  });
  const entry = resolved.find((candidate) => candidate.definition.key === feature);

  /*
   * Two different outcomes, and the distinction is the point.
   *
   * An anonymous visitor asking for a feature that merely needs a session gets
   * sent to sign in and returned here afterwards — 404ing them would lose the
   * destination and read as a broken link.
   *
   * Everything else 404s. Not visible is made indistinguishable from not
   * existing on purpose: a 403 would confirm both that a feature exists and
   * that this account lacks it, which is a probe worth denying.
   */
  if (!session && entry?.reason === 'requires-auth') {
    redirect(`/login?next=${encodeURIComponent(`/portal/${feature}`)}`);
  }

  if (!entry?.visible) notFound();

  const Screen = nextDynamic(definition.mount, {
    loading: () => <div className="h-40 animate-pulse rounded-xl bg-ink/[0.05]" />,
  });

  return <Screen locale={clientEnv.NEXT_PUBLIC_DEFAULT_LOCALE} tenant={tenant} />;
}
