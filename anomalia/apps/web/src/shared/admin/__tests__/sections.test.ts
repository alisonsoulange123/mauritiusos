import { describe, expect, it } from 'vitest';
import type { Role } from '@anomalia/contracts';
import { hasBackOffice, sectionsFor } from '../sections';

const hrefs = (roles: Role[]) => sectionsFor(roles).map((section) => section.href);

describe('sectionsFor', () => {
  it('gives an advisor the directory and nothing else', () => {
    expect(hrefs(['advisor'])).toEqual(['/admin/users']);
  });

  it('gives a knowledge manager the knowledge base and nothing else', () => {
    /*
     * The case that motivated this list. The Back Office originally gated on
     * "advisor or admin", so the role the platform created specifically to
     * curate knowledge was redirected out of the tool built for it.
     */
    expect(hrefs(['knowledge_manager'])).toEqual(['/admin/knowledge']);
  });

  it('gives an admin everything', () => {
    expect(hrefs(['admin'])).toEqual(['/admin/users', '/admin/knowledge', '/admin/audit']);
  });

  it('unions the sections of someone holding several roles', () => {
    expect(hrefs(['advisor', 'knowledge_manager'])).toEqual([
      '/admin/users',
      '/admin/knowledge',
    ]);
  });

  it('gives customers nothing at all', () => {
    for (const role of ['visitor', 'lead', 'client', 'partner'] as Role[]) {
      expect(hrefs([role])).toEqual([]);
      expect(hasBackOffice([role])).toBe(false);
    }
    expect(hasBackOffice([])).toBe(false);
  });

  it('keeps the audit trail to admins', () => {
    // It records what everyone in the tenant did, colleagues included.
    for (const role of ['advisor', 'knowledge_manager'] as Role[]) {
      expect(hrefs([role])).not.toContain('/admin/audit');
    }
  });
});
