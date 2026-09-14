import Link from 'next/link';
import { ROLES } from '@anomalia/contracts';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fetchAccounts } from '@/shared/admin/admin.api';
import { RoleBadge } from '@/components/admin/role-badge';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

interface SearchParams {
  search?: string;
  role?: string;
  status?: string;
  unverified?: string;
  cursor?: string;
}

/**
 * The account directory.
 *
 * Filters live in the URL rather than in component state, so a filtered view
 * is a link: an operator can bookmark "unconfirmed leads", or paste it to a
 * colleague, and the back button works. It also means the whole page is a
 * server component — there is no client-side data fetching here at all, and
 * therefore no admin data in any browser bundle.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSection('/admin/users');

  const params = await searchParams;
  const unverifiedOnly = params.unverified === '1';

  const page = await fetchAccounts({
    ...(params.search ? { search: params.search } : {}),
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    unverifiedOnly,
  });

  return (
    <div>
      <Eyebrow>Accounts</Eyebrow>
      <h1 className="mt-6 text-title text-balance">Directory</h1>

      {/* A GET form: submitting it navigates, which is what puts the filters
          in the URL. No JavaScript is involved in filtering. */}
      <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-56">
          <span className="text-caption font-medium text-ink">Search</span>
          <input
            name="search"
            type="search"
            defaultValue={params.search ?? ''}
            placeholder="Email or name"
            className="mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:border-ink/50"
          />
        </label>

        <Select name="role" label="Role" value={params.role} options={[...ROLES]} />
        <Select
          name="status"
          label="Status"
          value={params.status}
          options={['pending', 'active', 'suspended']}
        />

        <label className="flex items-center gap-2 pb-3 text-caption text-ink">
          <input
            type="checkbox"
            name="unverified"
            value="1"
            defaultChecked={unverifiedOnly}
            className="size-4 accent-ink"
          />
          Unconfirmed only
        </label>

        <button
          type="submit"
          className="mb-1 rounded-lg border border-hairline/30 px-4 py-2.5 text-caption text-ink transition-colors hover:border-ink/50"
        >
          Apply
        </button>
      </form>

      {page.items.length === 0 ? (
        <p className="mt-12 text-body text-muted">No account matches those filters.</p>
      ) : (
        <ul className="mt-10 divide-y divide-hairline/[0.12] border-t border-hairline/[0.12]">
          {page.items.map((account) => (
            <li key={account.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <Link
                  href={`/admin/users/${account.id}`}
                  className="text-body text-ink underline-offset-4 hover:underline"
                >
                  {account.name ?? account.email}
                </Link>
                <div className="flex items-center gap-3">
                  <RoleBadge role={account.role} />
                  {/* Surfaced in the list, not just on the detail page: this is
                      the single fact that decides whether the account can be
                      promoted, so hiding it one click deep would make every
                      refused promotion a surprise. */}
                  {account.emailVerified ? null : (
                    <span className="text-caption text-muted">unconfirmed</span>
                  )}
                  {account.status === 'active' ? null : (
                    <span className="text-caption text-muted">{account.status}</span>
                  )}
                </div>
              </div>
              {account.name ? (
                <p className="mt-0.5 text-caption text-muted">{account.email}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <p className="mt-8">
          <Link
            href={`/admin/users?${nextPageQuery(params, page.nextCursor)}`}
            className="text-caption text-ink underline underline-offset-4"
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Carries the current filters onto the next page; only the cursor moves. */
function nextPageQuery(params: SearchParams, cursor: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'cursor') query.set(key, value);
  }
  query.set('cursor', cursor);
  return query.toString();
}

function Select({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: string[];
}) {
  return (
    <label>
      <span className="text-caption font-medium text-ink">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="mt-2 block rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2.5 text-body text-ink focus:border-ink/50"
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  );
}
