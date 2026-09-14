import { fetchCapabilities } from '@/shared/capabilities/capabilities';
import { navigationFor, resolveFeatures } from '@/features/resolve-features';
import { getSession } from '@/shared/auth/session';
import { clientEnv } from '@/shared/config/client-env';
import { Container } from '@/components/ui/container';
import { PortalNav } from './nav';

/**
 * The portal shell.
 *
 * Navigation is COMPUTED, never authored: the feature registry filtered by
 * what the API serves and what this viewer may see. Adding a feature adds a
 * nav item; disabling a backend module removes one; neither touches this file.
 *
 * Global chrome (header, footer) lives in the root layout — this adds only the
 * in-app section navigation.
 */
export const dynamic = 'force-dynamic';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [capabilities, session] = await Promise.all([
    fetchCapabilities(clientEnv.NEXT_PUBLIC_DEFAULT_TENANT),
    getSession(),
  ]);

  /*
   * The session is REAL here, and the layout does not redirect on its absence —
   * each page does, because only a page knows its own path and can send the
   * visitor back to it after signing in. An anonymous request resolves to an
   * empty nav, which is never seen: the page below redirects during the same
   * render.
   */
  const resolved = resolveFeatures({
    capabilities,
    roles: session?.roles ?? [],
    authenticated: Boolean(session),
  });

  return (
    <Container className="flex flex-col gap-10 py-[clamp(2.5rem,1.5rem+3vw,4.5rem)] lg:flex-row lg:gap-16">
      <PortalNav items={navigationFor(resolved)} />
      <div className="min-w-0 flex-1">{children}</div>
    </Container>
  );
}
