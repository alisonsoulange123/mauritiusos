import { cn } from '@/shared/lib/cn';

/**
 * Editorial state at a glance.
 *
 * Only `published` is filled. An editor scanning a list is asking one question
 * — what is the platform currently asserting? — and everything else is a stage
 * on the way there.
 */
export function StatusBadge({ status, stale }: { status: string; stale?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={cn(
          'rounded-full px-2.5 py-0.5 text-caption',
          status === 'published'
            ? 'bg-ink text-surface'
            : 'border border-hairline/25 text-muted',
        )}
      >
        {status}
      </span>
      {/* Published but past its verification window: live in the database and
          silently withheld by search. Worth saying out loud, because from the
          outside it looks identical to a healthy item. */}
      {stale ? <span className="text-caption text-ink">needs re-verification</span> : null}
    </span>
  );
}
