import Link from 'next/link';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fetchSources } from '@/shared/admin/knowledge.api';
import { SourceForm } from '@/components/admin/source-form';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

/**
 * Provenance.
 *
 * Sources exist so that publication can require one — without a way to record
 * them, the rule that every published fact must be traceable would make the
 * knowledge base unpublishable.
 */
export default async function SourcesPage() {
  await requireSection('/admin/knowledge');

  const sources = await fetchSources();

  return (
    <div>
      <Eyebrow>Knowledge</Eyebrow>
      <h1 className="mt-6 text-title text-balance">Sources</h1>
      <p className="mt-4 max-w-prose text-body text-muted text-pretty">
        Every published item cites one of these. Authority travels with the citation, so the
        concierge can weigh an official circular differently from an editorial note.
      </p>

      {sources.length === 0 ? (
        <p className="mt-10 text-body text-muted">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-10 divide-y divide-hairline/[0.12] border-t border-hairline/[0.12]">
          {sources.map((source) => (
            <li key={source.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
              <div>
                <p className="text-body text-ink">{source.name}</p>
                {source.url ? (
                  <p className="mt-0.5 break-all text-caption text-muted">{source.url}</p>
                ) : null}
              </div>
              <span className="text-caption text-muted">
                {source.sourceType} · {source.authorityLevel}
              </span>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-12 border-t border-hairline/[0.12] pt-8">
        <Eyebrow>Record a source</Eyebrow>
        <SourceForm />
      </section>

      <p className="mt-12 text-caption text-muted">
        <Link href="/admin/knowledge" className="underline underline-offset-4 hover:text-ink">
          Back to the index
        </Link>
      </p>
    </div>
  );
}
