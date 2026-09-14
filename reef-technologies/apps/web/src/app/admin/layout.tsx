import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { getSession } from '@/shared/auth/session';
import { sectionsFor } from '@/shared/admin/sections';
import { AdminNav } from './nav';

export const metadata = { title: 'Back Office' };

/** Reads the session on every request; never pre-rendered, never cached. */
export const dynamic = 'force-dynamic';

/**
 * The Back Office shell, and its gate.
 *
 * The gate is here rather than on each page because every route beneath this
 * one has the same answer — and a per-page check is a check somebody forgets
 * when they add the seventh page.
 *
 * It is not the security boundary. Every endpoint behind these screens carries
 * its own `@Roles`, and the role policy runs server-side regardless of what
 * this layout decided. This gate exists so the wrong person sees a redirect
 * instead of a page of failing requests.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login?next=/admin');

  /*
   * Admission is "can you see anything here", not "are you an admin". A
   * knowledge manager has no business in the account directory and every
   * business in the knowledge base; gating on a role list rather than on
   * sections would have locked them out of their own tool.
   */
  const sections = sectionsFor(session.roles);
  if (sections.length === 0) redirect('/portal');

  const standing = session.roles.includes('admin')
    ? 'Administrator'
    : session.roles.includes('advisor')
      ? 'Advisor'
      : 'Knowledge manager';

  return (
    <Container className="flex flex-col gap-10 py-[clamp(2.5rem,1.5rem+3vw,4.5rem)] lg:flex-row lg:gap-16">
      <div className="w-full shrink-0 lg:w-52">
        <Eyebrow>Back office</Eyebrow>
        {/* The operator's own standing, shown rather than assumed: an advisor
            and an admin see different things here, and knowing which you are
            explains why. */}
        <p className="mt-2 text-caption text-muted">
          {session.email}
          <br />
          <span className="text-ink">{standing}</span>
        </p>

        <AdminNav sections={sections} />

        <p className="mt-8 text-caption text-muted">
          <Link href="/portal" className="underline underline-offset-4 hover:text-ink">
            Back to the portal
          </Link>
        </p>
      </div>

      <div className="min-w-0 flex-1">{children}</div>
    </Container>
  );
}
