import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ApiRequestError } from '@/shared/api/client';
import { fetchKnowledgeItem, fetchSources } from '@/shared/admin/knowledge.api';
import { StatusBadge } from '@/components/admin/status-badge';
import { KnowledgeEditor } from '@/components/admin/knowledge-editor';
import { LifecycleControls, VerifyControl } from '@/components/admin/lifecycle-controls';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

export default async function KnowledgeItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSection('/admin/knowledge');

  const { id } = await params;
  const item = await load(id);
  const sources = await fetchSources();

  return (
    <div>
      <Eyebrow>Knowledge item</Eyebrow>
      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="text-title text-balance">{item.title}</h1>
        <StatusBadge status={item.status} stale={item.stale} />
      </div>
      <p className="mt-2 font-mono text-caption text-muted">
        /{item.locale}/{item.slug}
      </p>

      <dl className="mt-8 grid gap-x-8 gap-y-4 border-t border-hairline/[0.12] pt-6 sm:grid-cols-3">
        <Fact label="Source">
          {item.sourceName ? (
            `${item.sourceName} (${item.sourceAuthority})`
          ) : (
            /* The one fact that decides whether this can ever be published. */
            <span className="text-ink">None — cannot be published</span>
          )}
        </Fact>
        <Fact label="Confidence">{item.confidenceScore}</Fact>
        <Fact label="Last verified">{formatDate(item.verifiedAt) ?? 'Never'}</Fact>
      </dl>

      <section className="mt-12 border-t border-hairline/[0.12] pt-8">
        <Eyebrow>Lifecycle</Eyebrow>
        <LifecycleControls id={item.id} nextStates={item.nextStates} />
      </section>

      <section className="mt-12 border-t border-hairline/[0.12] pt-8">
        <Eyebrow>Verification</Eyebrow>
        <p className="mt-4 max-w-prose text-body text-muted text-pretty">
          {item.stale
            ? 'This item is published but past its verification window, so search is already withholding it. Re-check the source and record it below.'
            : 'Recording a check is separate from editing: one says what the platform asserts, the other says somebody confirmed it still holds.'}
        </p>
        <VerifyControl id={item.id} confidence={item.confidenceScore} />
      </section>

      <section className="mt-12 border-t border-hairline/[0.12] pt-8">
        <Eyebrow>{item.editable ? 'Content' : 'Content (frozen)'}</Eyebrow>

        {item.editable ? (
          <KnowledgeEditor item={item} sources={sources} />
        ) : (
          <>
            <p className="mt-4 max-w-prose text-body text-muted text-pretty">
              Published text cannot be edited. It carries a verification date, and rewriting the
              words behind that date would make it describe a paragraph nobody verified. Send it
              back for review to make changes.
            </p>
            <pre className="mt-6 max-w-prose whitespace-pre-wrap border-l-2 border-hairline/20 pl-4 font-mono text-caption leading-relaxed text-muted">
              {item.content}
            </pre>
          </>
        )}
      </section>

      <p className="mt-12 text-caption text-muted">
        <Link href="/admin/knowledge" className="underline underline-offset-4 hover:text-ink">
          Back to the index
        </Link>
      </p>
    </div>
  );
}

/** Anything the API will not resolve is a not-found, never a server fault. */
async function load(id: string) {
  try {
    return await fetchKnowledgeItem(id);
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

const formatDate = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;
