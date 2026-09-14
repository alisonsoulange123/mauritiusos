import { describe, expect, it } from 'vitest';
import { SampleItem } from '../domain/sample-item.entity.js';

/**
 * Domain tests: no database, no Nest, no mocks. Microseconds per case.
 * This is the payoff of keeping the domain layer pure.
 */
const make = (overrides: Partial<{ title: string }> = {}) =>
  SampleItem.create({
    id: '11111111-1111-1111-1111-111111111111',
    tenantId: '22222222-2222-2222-2222-222222222222',
    ownerId: '33333333-3333-3333-3333-333333333333',
    title: 'Prepare retirement permit documents',
    ...overrides,
  });

describe('SampleItem', () => {
  it('starts as a draft and trims the title', () => {
    const item = SampleItem.create({
      id: 'a',
      tenantId: 'b',
      ownerId: 'c',
      title: '  Occupation Permit checklist  ',
    });
    expect(item.status).toBe('draft');
    expect(item.title).toBe('Occupation Permit checklist');
  });

  it('rejects a title that is too short', () => {
    expect(() => make({ title: 'ab' })).toThrow(/at least 3 characters/);
  });

  it('rejects a title over the length limit', () => {
    expect(() => make({ title: 'x'.repeat(141) })).toThrow(/may not exceed/);
  });

  it('refuses to archive a draft', () => {
    expect(() => make().archive()).toThrow(/Activate the item before archiving/);
  });

  it('archives once active', () => {
    const item = make();
    item.activate();
    item.archive();
    expect(item.status).toBe('archived');
  });

  it('refuses to reactivate an archived item', () => {
    const item = make();
    item.activate();
    item.archive();
    expect(() => item.activate()).toThrow(/cannot be reactivated/);
  });

  it('answers ownership questions', () => {
    const item = make();
    expect(item.isOwnedBy('33333333-3333-3333-3333-333333333333')).toBe(true);
    expect(item.isOwnedBy('someone-else')).toBe(false);
  });
});
