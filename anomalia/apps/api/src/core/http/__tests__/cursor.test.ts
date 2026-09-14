import { describe, expect, it } from 'vitest';
import { DomainError } from '@anomalia/contracts';
import { decodeTimeCursor, encodeTimeCursor } from '../cursor.js';

const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9';

describe('time cursors', () => {
  it('round-trips the pair', () => {
    const at = new Date('2026-09-14T08:16:43.672Z');

    const decoded = decodeTimeCursor(encodeTimeCursor(at, ID));

    expect(decoded?.at.toISOString()).toBe(at.toISOString());
    expect(decoded?.id).toBe(ID);
  });

  it('keeps millisecond precision', () => {
    /*
     * The reason the cursor is a pair at all. Two rows inserted in the same
     * millisecond are distinguished by id — but only if the timestamp survives
     * the round trip intact. A cursor truncated to the second would silently
     * skip every row sharing that second.
     */
    const at = new Date('2026-09-14T08:16:43.001Z');

    expect(decodeTimeCursor(encodeTimeCursor(at, ID))?.at.getMilliseconds()).toBe(1);
  });

  it('treats an absent cursor as the first page', () => {
    expect(decodeTimeCursor(undefined)).toBeNull();
    expect(decodeTimeCursor('')).toBeNull();
  });

  it('refuses a malformed cursor instead of silently restarting', () => {
    /*
     * The failure that matters. Falling back to page one would loop a client
     * forever: it asks for the next page, gets the first, and asks again with
     * the same cursor. A 400 is the only answer it can notice.
     */
    for (const bad of ['not-base64-at-all!!', 'Zm9v', encode('nonsense|' + ID)]) {
      expect(() => decodeTimeCursor(bad)).toThrow(DomainError);
    }
  });

  it('refuses a cursor whose id is not an id', () => {
    // Cursors are echoed back by clients and pasted into URLs; the id goes
    // into a SQL cast, so it is validated rather than trusted.
    expect(() => decodeTimeCursor(encode('2026-09-14T08:16:43.672Z|../../etc'))).toThrow(
      DomainError,
    );
    expect(() => decodeTimeCursor(encode('2026-09-14T08:16:43.672Z|'))).toThrow(DomainError);
  });

  it('orders the same instant by id', () => {
    // Two cursors for one instant must differ, or paging stalls on ties.
    const at = new Date('2026-09-14T08:16:43.672Z');

    expect(encodeTimeCursor(at, ID)).not.toBe(encodeTimeCursor(at, OTHER));
  });
});

const encode = (value: string) => Buffer.from(value).toString('base64url');
