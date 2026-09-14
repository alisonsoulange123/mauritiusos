import { describe, expect, it } from 'vitest';
import { slugify } from '../domain/slug.js';

describe('slugify', () => {
  it('makes a readable slug from a title', () => {
    expect(slugify('Retirement Residence Permit')).toBe('retirement-residence-permit');
  });

  it('folds diacritics rather than dropping them', () => {
    /*
     * The platform publishes in French. Stripping accents outright turns
     * "Résidence fiscale" into "rsidence-fiscale" — unreadable, unguessable,
     * and not what a French editor expects to see in the address bar.
     */
    expect(slugify('Résidence fiscale et règle des 183 jours')).toBe(
      'residence-fiscale-et-regle-des-183-jours',
    );
    expect(slugify('Créer une société à Maurice')).toBe('creer-une-societe-a-maurice');
  });

  it('collapses punctuation instead of leaving gaps', () => {
    expect(slugify('Tax residence — the 183-day rule (2026)')).toBe(
      'tax-residence-the-183-day-rule-2026',
    );
  });

  it('never leaves a leading or trailing hyphen', () => {
    expect(slugify('  ...Permits!  ')).toBe('permits');
    // Including after the length cap lands mid-separator.
    expect(slugify(`${'a'.repeat(79)} word`).endsWith('-')).toBe(false);
  });

  it('returns empty when a title has nothing to slug', () => {
    // The caller refuses this rather than writing a row keyed on ''.
    expect(slugify('!!! ??? —')).toBe('');
  });
});
