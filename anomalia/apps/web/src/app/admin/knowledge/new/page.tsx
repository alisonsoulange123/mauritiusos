import Link from 'next/link';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fetchSources } from '@/shared/admin/knowledge.api';
import { KnowledgeEditor } from '@/components/admin/knowledge-editor';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

export default async function NewKnowledgePage() {
  await requireSection('/admin/knowledge');

  const sources = await fetchSources();

  return (
    <div>
      <Eyebrow>Knowledge</Eyebrow>
      <h1 className="mt-6 text-title text-balance">New item</h1>
      <p className="mt-4 max-w-prose text-body text-muted text-pretty">
        It starts as a draft. Publication is a separate, audited decision, and it will be refused
        until this cites a source and someone has verified it.
      </p>

      {sources.length === 0 ? (
        /* The bootstrap trap, named rather than hit: with no sources recorded,
           nothing written here could ever be published. */
        <p className="mt-6 max-w-prose border-l-2 border-ink py-1 pl-3 text-caption text-ink text-pretty">
          No sources are recorded yet, so nothing can be published.{' '}
          <Link href="/admin/knowledge/sources" className="underline underline-offset-4">
            Record one first
          </Link>
          .
        </p>
      ) : null}

      <KnowledgeEditor sources={sources} />
    </div>
  );
}
