import { DomainError, ERROR_CODES } from '@anomalia/contracts';

/**
 * Cursors for newest-first listings.
 *
 * The platform's convention is cursor pagination because offsets break under
 * concurrent writes — page 2 skips a row whenever something is inserted while
 * someone is reading. The existing listings order by `id`, which is fine when
 * nobody reads them in order; an administrative directory is read in order,
 * and the order people want is "most recent first".
 *
 * A timestamp alone is not a cursor: two rows can share a millisecond, and
 * `created_at < cursor` would then drop one of them silently. So the cursor is
 * the pair, compared row-wise in SQL:
 *
 *     (created_at, id) < (cursorAt, cursorId)
 *
 * which is total, stable, and index-friendly against `(tenant_id, created_at)`.
 */
export interface TimeCursor {
  at: Date;
  id: string;
}

export const encodeTimeCursor = (at: Date, id: string): string =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');

/**
 * Rejects a malformed cursor rather than ignoring it.
 *
 * Silently falling back to the first page would loop a client forever: it asks
 * for the next page, receives page one, and asks again with the same cursor.
 * A 400 is the only answer that lets the caller notice.
 */
export function decodeTimeCursor(raw: string | undefined): TimeCursor | null {
  if (!raw) return null;

  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  const at = separator > 0 ? new Date(decoded.slice(0, separator)) : null;
  const id = separator > 0 ? decoded.slice(separator + 1) : '';

  if (!at || Number.isNaN(at.getTime()) || !UUID.test(id)) {
    throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'That page cursor is not valid.', 400);
  }

  return { at, id };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
