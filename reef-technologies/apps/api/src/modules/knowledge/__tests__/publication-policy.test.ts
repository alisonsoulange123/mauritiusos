import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  isEditable,
  refusePublication,
  refuseTransition,
  verificationExpired,
  type KnowledgeStatus,
  type PublishableItem,
} from '../domain/publication-policy.js';

const FLOOR = 0.7; // KNOWLEDGE_MIN_CONFIDENCE's default, as a fraction

const publishable = (overrides: Partial<PublishableItem> = {}): PublishableItem => ({
  sourceId: 'src-1',
  verifiedAt: new Date('2026-09-01T00:00:00Z'),
  content: 'Non-citizens aged 50 and above may apply for a Retirement Residence Permit.',
  confidenceScore: 95,
  ...overrides,
});

describe('refusePublication', () => {
  it('lets a sourced, verified, confident item go out', () => {
    expect(refusePublication(publishable(), FLOOR)).toBeNull();
  });

  it('refuses an unsourced item', () => {
    /*
     * The module's whole claim. Every fact the platform states "must come from
     * here, with a source and a verification date" — a sentence that was only
     * true in a comment until something enforced it.
     */
    expect(refusePublication(publishable({ sourceId: null }), FLOOR)).toBe('no-source');
  });

  it('refuses an item nobody has ever verified', () => {
    /*
     * Not a nicety. Search filters on `verifiedAt IS NULL OR verifiedAt > now()
     * - ttl`, so a NULL passes the freshness gate forever: the item would be
     * served as authoritative indefinitely, which is the opposite of what the
     * gate is for. Requiring a date here closes that branch.
     */
    expect(refusePublication(publishable({ verifiedAt: null }), FLOOR)).toBe('never-verified');
  });

  it('refuses an item that would be published into invisibility', () => {
    // Below the floor search filters on: live, and never in a single result.
    expect(refusePublication(publishable({ confidenceScore: 69 }), FLOOR)).toBe(
      'below-confidence-floor',
    );
    // Exactly at the floor is in.
    expect(refusePublication(publishable({ confidenceScore: 70 }), FLOOR)).toBeNull();
  });

  it('refuses content that is only whitespace', () => {
    expect(refusePublication(publishable({ content: '   \n\t ' }), FLOOR)).toBe('empty-content');
  });

  it('reports provenance before anything else', () => {
    // An item failing several rules is told about the one that matters most,
    // rather than sending the editor round a loop of one fix per attempt.
    const broken = publishable({ sourceId: null, verifiedAt: null, confidenceScore: 10 });
    expect(refusePublication(broken, FLOOR)).toBe('no-source');
  });
});

describe('refuseTransition', () => {
  it('walks the editorial path', () => {
    expect(refuseTransition('draft', 'review')).toBeNull();
    expect(refuseTransition('review', 'published')).toBeNull();
    expect(refuseTransition('published', 'archived')).toBeNull();
    expect(refuseTransition('archived', 'draft')).toBeNull();
  });

  it('refuses publishing straight from a draft', () => {
    // Publication is an approval, so it has to be approached from `review`.
    expect(refuseTransition('draft', 'published')).toBe('invalid-transition');
  });

  it('refuses reviving an archived item straight into publication', () => {
    expect(refuseTransition('archived', 'published')).toBe('invalid-transition');
    expect(refuseTransition('archived', 'review')).toBe('invalid-transition');
  });

  it('takes a published item down through review, never straight to draft', () => {
    // Withdrawing something the concierge may be citing should be one named,
    // auditable step rather than a side effect of opening an editor.
    expect(refuseTransition('published', 'review')).toBeNull();
    expect(refuseTransition('published', 'draft')).toBe('invalid-transition');
  });

  it('treats a no-op as a no-op', () => {
    for (const status of ['draft', 'review', 'published', 'archived'] as KnowledgeStatus[]) {
      expect(refuseTransition(status, status)).toBe('unchanged');
    }
  });

  it('offers exactly the transitions it permits', () => {
    // The UI renders `allowedTransitions`, so the two must not drift: an option
    // the policy refuses is a button that always errors.
    for (const from of ['draft', 'review', 'published', 'archived'] as KnowledgeStatus[]) {
      for (const to of allowedTransitions(from)) {
        expect(refuseTransition(from, to)).toBeNull();
      }
    }
  });
});

describe('isEditable', () => {
  it('freezes published text', () => {
    /*
     * The reason is the verification date, not procedure: rewriting the words
     * behind "verified on the 3rd" makes that date describe a paragraph nobody
     * verified.
     */
    expect(isEditable('published')).toBe(false);
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('review')).toBe(true);
    expect(isEditable('archived')).toBe(true);
  });
});

describe('verificationExpired', () => {
  const now = new Date('2026-09-14T00:00:00Z');

  it('expires an item older than the window', () => {
    expect(verificationExpired(new Date('2026-01-01T00:00:00Z'), 180, now)).toBe(true);
  });

  it('keeps one inside it', () => {
    expect(verificationExpired(new Date('2026-08-01T00:00:00Z'), 180, now)).toBe(false);
  });

  it('does not call a never-verified item expired', () => {
    // It is a different problem with a different answer: publication refuses
    // it outright, so it never reaches the staleness question.
    expect(verificationExpired(null, 180, now)).toBe(false);
  });
});
