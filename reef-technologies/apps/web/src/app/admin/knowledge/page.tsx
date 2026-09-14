import Link from 'next/link';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fetchKnowledge } from '@/shared/admin/knowledge.api';
import { StatusBadge } from '@/components/admin/status-badge';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

interface SearchParams {
  status?: string;
  search?: string;
  language?: string;
  stale?: string;
  cursor?: string;
}

/**
 * The editorial index.
 *
 * Shows drafts and archived items alongside published ones, which is the whole
 * reason it is not the public search: search exists to serve only what is
 * safely publishable, and this exists to show the editor everything search is
 * refusing — the drafts, and the published items whose verification lapsed.
 */
export default async function KnowledgeIndexPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireSection('/admin/knowledge');

  const params = await searchParams;
  const staleOnly = params.stale === '1';

  const page = await fetchKnowledge({
    ...(params.status ? { status: params.status } : {}),
    ...(params.search ? { search: params.search } : {}),
    ...(params.language ? { language: params.language } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
    staleOnly,
  });

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <Eyebrow>Knowledge</Eyebrow>
          <h1 className="mt-6 text-title text-balance">What the platform asserts</h1>
        </div>
        <div className="flex gap-4 text-caption">
          <Link href="/admin/knowledge/sources" className="text-muted underline underline-offset-4 hover:text-ink">
            Sources
          </Link>
          <Link href="/admin/knowledge/new" className="text-ink underline underline-offset-4">
            New item
          </Link>
        </div>
      </div>

      <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        <label className="flex-1 basis-56">
          <span className="text-caption font-medium text-ink">Search</span>
          <input
            name="search"
            type="search"
            defaultValue={params.search ?? ''}
            placeholder="Title or slug"
            className="mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:border-ink/50"
          />
        </label>

        <Select name="status" label="State" value={params.status} options={['draft', 'review', 'published', 'archived']} />
        <Select name="language" label="Language" value={params.language} options={['en', 'fr']} />

        <label className="flex items-center gap-2 pb-3 text-caption text-ink">
          <input type="checkbox" name="stale" value="1" defaultChecked={staleOnly} className="size-4 accent-ink" />
          Needs re-verification
        </label>

        <button
          type="submit"
          className="mb-1 rounded-lg border border-hairline/30 px-4 py-2.5 text-caption text-ink transition-colors hover:border-ink/50"
        >
          Apply
        </button>
      </form>

      {page.items.length === 0 ? (
        <p className="mt-12 text-body text-muted">Nothing matches those filters.</p>
      ) : (
        <ul className="mt-10 divide-y divide-hairline/[0.12] border-t border-hairline/[0.12]">
          {page.items.map((item) => (
            <li key={item.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                <Link
                  href={`/admin/knowledge/${item.id}`}
                  className="text-body text-ink underline-offset-4 hover:underline"
                >
                  {item.title}
                </Link>
                <StatusBadge status={item.status} stale={item.stale} />
              </div>
              <p className="mt-0.5 text-caption text-muted">
                {item.type} · {item.category} · {item.locale} · confidence {item.confidenceScore}
                {/* Named here, not just on the detail page: an item with no
                    source can never be published, and that is the single most
                    useful thing to know while scanning a list of drafts. */}
                {item.sourceName ? ` · ${item.sourceName}` : ' · no source'}
              </p>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <p className="mt-8">
          <Link
            href={`/admin/knowledge?${nextPageQuery(params, page.nextCursor)}`}
            className="text-caption text-ink underline underline-offset-4"
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

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
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
