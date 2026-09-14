import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ApiRequestError } from '@/shared/api/client';
import { fetchAccount } from '@/shared/admin/admin.api';
import { getSession } from '@/shared/auth/session';
import { RoleBadge } from '@/components/admin/role-badge';
import { RoleForm } from '@/components/admin/role-form';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSection('/admin/users');

  const { id } = await params;

  const [account, session] = await Promise.all([loadAccount(id), getSession()]);
  const isSelf = session?.userId === account.id;

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <h1 className="mt-6 text-title text-balance">{account.name ?? account.email}</h1>
      <p className="mt-2 text-body text-muted">{account.email}</p>

      <dl className="mt-10 grid gap-x-8 gap-y-4 border-t border-hairline/[0.12] pt-6 sm:grid-cols-2">
        <Fact label="Role">
          <RoleBadge role={account.role} />
        </Fact>
        <Fact label="Status">{account.status}</Fact>
        <Fact label="Email confirmed">
          {account.emailVerified ? formatDate(account.emailVerifiedAt) : 'Not confirmed'}
        </Fact>
        <Fact label="Registered">{formatDate(account.createdAt)}</Fact>
        <Fact label="Language">{account.locale}</Fact>
        {/* Approximate and labelled as such — it answers "are they still
            signed in somewhere", which is most of what support asks. */}
        <Fact label="Active sessions">{account.activeSessions}</Fact>
        {account.profile?.nationality ? (
          <Fact label="Nationality">{account.profile.nationality}</Fact>
        ) : null}
        {account.profile?.currentCountry ? (
          <Fact label="Currently in">{account.profile.currentCountry}</Fact>
        ) : null}
        {account.profile?.journeyStage ? (
          <Fact label="Journey stage">{account.profile.journeyStage}</Fact>
        ) : null}
      </dl>

      <section className="mt-12 border-t border-hairline/[0.12] pt-8">
        <Eyebrow>Change role</Eyebrow>

        {isSelf ? (
          /* The backend refuses this too — it is the rule that stops the last
             admin from demoting themselves into an unrecoverable tenant. Said
             here as well so the operator reads an explanation rather than
             submitting a form that was always going to fail. */
          <p className="mt-4 max-w-prose text-body text-muted text-pretty">
            This is your own account. Nobody changes their own role, including
            administrators — it is what prevents the last admin from locking the
            tenant out. Ask another administrator.
          </p>
        ) : (
          <>
            {account.emailVerified ? null : (
              <p className="mt-4 max-w-prose text-body text-muted text-pretty">
                This account has not confirmed its email address, so it cannot be given
                anything above <em>lead</em>. They can confirm from their own portal.
              </p>
            )}
            <RoleForm userId={account.id} currentRole={account.role} />
          </>
        )}
      </section>

      <p className="mt-12 text-caption text-muted">
        <Link
          href={`/admin/audit?resourceId=${account.id}`}
          className="text-ink underline underline-offset-4"
        >
          Audit trail for this account
        </Link>
        {' · '}
        <Link href="/admin/users" className="underline underline-offset-4 hover:text-ink">
          Back to the directory
        </Link>
      </p>
    </div>
  );
}

/**
 * Anything the API will not resolve to an account becomes a 404 here.
 *
 * Both statuses land in the same place, deliberately. 404 is the API's answer
 * for an account in another tenant as well as one that does not exist —
 * confirming an id exists is itself a disclosure — and 400 is what a malformed
 * id in the URL produces. Neither is a server fault, and rendering a typo in
 * the address bar as a 500 would put an error in the logs for every mistyped
 * link while telling the operator that something broke.
 */
async function loadAccount(id: string) {
  try {
    return await fetchAccount(id);
  } catch (error) {
    const unresolvable =
      error instanceof ApiRequestError && (error.status === 404 || error.status === 400);
    if (unresolvable) notFound();
    throw error;
  }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="mt-1 text-body text-ink">{children}</dd>
    </div>
  );
}

const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—';
