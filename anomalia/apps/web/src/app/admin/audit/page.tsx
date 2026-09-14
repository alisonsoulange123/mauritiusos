import Link from 'next/link';
import { Eyebrow } from '@/components/ui/eyebrow';
import { fetchAuditTrail, type AuditRow } from '@/shared/admin/admin.api';
import { requireSection } from '@/shared/admin/guard';

export const dynamic = 'force-dynamic';

interface SearchParams {
  action?: string;
  result?: string;
  resourceId?: string;
  cursor?: string;
}

/** Prefix filters, named the way an operator thinks about them. */
const SCOPES = [
  { value: '', label: 'Everything' },
  { value: 'identity.login', label: 'Sign-ins' },
  { value: 'identity.role.', label: 'Role changes' },
  { value: 'identity.password.', label: 'Password resets' },
  { value: 'identity.email.', label: 'Email confirmation' },
  { value: 'identity.session.', label: 'Session security' },
];

/**
 * The audit trail.
 *
 * Admin only — the layout hides the nav entry for advisors, and this checks
 * again, because a hidden link is not an access control and someone will
 * eventually paste the URL.
 *
 * Denied rows are the ones worth reading: a refused role change, a reset
 * requested for an address that does not exist, a detected token reuse. They
 * are marked rather than filtered so the pattern is visible in context.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Checked here as well as in the nav: a hidden link is not an access
  // control, and someone will eventually paste the URL.
  await requireSection('/admin/audit');
  const params = await searchParams;

  const page = await fetchAuditTrail(toFilters(params));

  return (
    <div>
      <Eyebrow>Audit</Eyebrow>
      <h1 className="mt-6 text-title text-balance">Trail</h1>
      <p className="mt-4 max-w-prose text-body text-muted text-pretty">
        Append-only. Every entry carries the trace id of the request that caused it, which
        maps to a log line.
      </p>

      <form method="get" className="mt-8 flex flex-wrap items-end gap-3">
        {params.resourceId ? (
          <input type="hidden" name="resourceId" value={params.resourceId} />
        ) : null}

        <label>
          <span className="text-caption font-medium text-ink">Scope</span>
          <select
            name="action"
            defaultValue={params.action ?? ''}
            className="mt-2 block rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2.5 text-body text-ink focus:border-ink/50"
          >
            {SCOPES.map((scope) => (
              <option key={scope.value} value={scope.value}>
                {scope.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="text-caption font-medium text-ink">Outcome</span>
          <select
            name="result"
            defaultValue={params.result ?? ''}
            className="mt-2 block rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2.5 text-body text-ink focus:border-ink/50"
          >
            <option value="">Any</option>
            <option value="success">Succeeded</option>
            <option value="denied">Denied</option>
            <option value="error">Errored</option>
          </select>
        </label>

        <button
          type="submit"
          className="mb-1 rounded-lg border border-hairline/30 px-4 py-2.5 text-caption text-ink transition-colors hover:border-ink/50"
        >
          Apply
        </button>
      </form>

      {params.resourceId ? (
        <p className="mt-6 text-caption text-muted">
          Filtered to one account.{' '}
          <Link href="/admin/audit" className="text-ink underline underline-offset-4">
            Clear
          </Link>
        </p>
      ) : null}

      <AuditTable rows={page.items} />

      {page.nextCursor ? (
        <p className="mt-8">
          <Link
            href={`/admin/audit?${nextPageQuery(params, page.nextCursor)}`}
            className="text-caption text-ink underline underline-offset-4"
          >
            Next page →
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/** Only the filters that were actually supplied reach the API. */
function toFilters(params: SearchParams) {
  return {
    ...(params.action ? { action: params.action } : {}),
    ...(params.result ? { result: params.result } : {}),
    ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    ...(params.cursor ? { cursor: params.cursor } : {}),
  };
}

/**
 * The only horizontally scrolling thing on the site, and deliberately: an
 * audit row has more columns than a phone has width, and truncating the action
 * name would make the table useless.
 */
function AuditTable({ rows }: { rows: AuditRow[] }) {
  if (rows.length === 0) {
    return <p className="mt-12 text-body text-muted">Nothing recorded for those filters.</p>;
  }

  return (
    <div className="mt-10 overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-hairline/[0.12]">
            <Th>When</Th>
            <Th>Action</Th>
            <Th>Outcome</Th>
            <Th>Actor</Th>
            <Th>Detail</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-hairline/[0.08] align-top">
              <Td className="whitespace-nowrap text-muted">{formatTime(row.occurredAt)}</Td>
              <Td className="font-mono text-caption">{row.action}</Td>
              <Td>
                {/* A denied row is the one worth noticing, so it keeps full
                    contrast while successes recede. */}
                <span className={row.result === 'success' ? 'text-muted' : 'text-ink'}>
                  {row.result}
                </span>
              </Td>
              <Td className="text-muted">{row.actorRole ?? '—'}</Td>
              <Td className="text-muted">{summarise(row)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The metadata worth reading, in one line.
 *
 * Audit metadata is free-form JSON by design — each action records what
 * matters to it. Dumping the object would be unreadable, so the few keys that
 * recur get a phrasing and anything else falls back to the resource id.
 */
function summarise(row: AuditRow): string {
  const { from, to, reason, email } = row.metadata as Record<string, string | undefined>;

  if (reason) return `refused: ${reason}`;
  if (from && to) return `${from} → ${to}`;
  if (email) return email;
  return row.resourceId ? `${row.resourceType} ${row.resourceId.slice(0, 8)}…` : row.resourceType;
}

function nextPageQuery(params: SearchParams, cursor: string): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== 'cursor') query.set(key, value);
  }
  query.set('cursor', cursor);
  return query.toString();
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="py-2 pr-6 text-caption font-medium text-muted">{children}</th>
);

const Td = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <td className={`py-2.5 pr-6 text-body ${className ?? ''}`}>{children}</td>
);

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
