import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ArrowLink } from '@/components/ui/arrow-link';
import { fetchCapabilities } from '@/shared/capabilities/capabilities';
import { resolveFeatures } from '@/features/resolve-features';
import { getSession } from '@/shared/auth/session';
import { clientEnv } from '@/shared/config/client-env';

export const metadata = { title: 'Portal' };

export const dynamic = 'force-dynamic';

const LOCK_COPY = {
  'requires-auth': 'Requires sign-in',
  /*
   * Registration issues `lead`. The concierge requires `client`, so this is
   * what a newly created account sees against it — an upgrade prompt, not a
   * missing feature and not a second sign-in.
   */
  'role-missing': 'Requires a client account',
  'module-disabled': 'Not enabled in this deployment',
} as const;

/**
 * The portal index — and the landing point after sign-in.
 *
 * It exists because `/portal` was the default redirect target and nothing
 * served it: every successful sign-in ended on a 404. It also gives the
 * capability system somewhere to be honest, by listing what this account
 * cannot reach alongside what it can, with the reason.
 */
export default async function PortalIndexPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/portal');

  const capabilities = await fetchCapabilities(clientEnv.NEXT_PUBLIC_DEFAULT_TENANT);
  const resolved = resolveFeatures({
    capabilities,
    roles: session.roles,
    authenticated: true,
  });

  const available = resolved.filter((entry) => entry.visible);
  const unavailable = resolved.filter((entry) => !entry.visible);

  return (
    <div>
      <Eyebrow>Signed in</Eyebrow>
      <h1 className="mt-6 text-title text-balance">{session.email}</h1>
      <p className="mt-4 max-w-prose text-lead text-muted text-pretty">
        {available.length > 0
          ? 'Everything below is open to this account.'
          : 'Nothing is open to this account yet.'}
      </p>

      {available.length > 0 ? (
        <ul className="mt-12 divide-y divide-hairline/[0.12] border-t border-hairline/[0.12]">
          {available.map((entry) => (
            <li key={entry.definition.key} className="py-6">
              <h2 className="text-heading">
                <Link href={`/portal/${entry.definition.key}`} className="hover:text-muted">
                  {entry.definition.title}
                </Link>
              </h2>
              <p className="mt-2 max-w-prose text-body text-muted text-pretty">
                {entry.definition.description}
              </p>
              <ArrowLink href={`/portal/${entry.definition.key}`} className="mt-3">
                Open
              </ArrowLink>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Listed rather than hidden. A feature that silently does not appear reads
        as a missing feature; one that appears with a reason reads as a
        boundary, which is the truth and is actionable.
      */}
      {unavailable.length > 0 ? (
        <section className="mt-14">
          <Eyebrow>Not available to this account</Eyebrow>
          <ul className="mt-5 space-y-2.5">
            {unavailable.map((entry) => (
              <li
                key={entry.definition.key}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline/[0.12] pb-2.5"
              >
                <span className="text-body text-muted">{entry.definition.title}</span>
                <span className="text-caption text-muted">
                  {LOCK_COPY[entry.reason ?? 'module-disabled']}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
