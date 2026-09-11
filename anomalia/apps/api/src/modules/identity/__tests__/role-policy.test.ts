import { describe, expect, it } from 'vitest';
import type { Role } from '@anomalia/contracts';
import { refuseRoleChange } from '../domain/role-policy.js';

const ADMIN = 'admin-1';
const ADVISOR = 'advisor-1';
const TARGET = 'target-1';

const ask = (actorId: string, actorRoles: Role[], from: Role, to: Role) =>
  refuseRoleChange({ actorId, actorRoles, targetId: TARGET, from, to });

describe('refuseRoleChange', () => {
  it('lets an advisor move a lead onto the paid tier', () => {
    // The case the whole feature exists for: registration issues `lead`, and
    // `client` is what unlocks the concierge.
    expect(ask(ADVISOR, ['advisor'], 'lead', 'client')).toBeNull();
    expect(ask(ADVISOR, ['advisor'], 'client', 'lead')).toBeNull();
  });

  it('stops an advisor from creating privilege', () => {
    // The escalation that matters: an advisor who can mint advisors has, in
    // effect, admin — one indirection away.
    expect(ask(ADVISOR, ['advisor'], 'lead', 'advisor')).toBe('requires-admin');
    expect(ask(ADVISOR, ['advisor'], 'lead', 'admin')).toBe('requires-admin');
    expect(ask(ADVISOR, ['advisor'], 'client', 'knowledge_manager')).toBe('requires-admin');
  });

  it('stops an advisor from stripping privilege', () => {
    // The reverse direction is just as sensitive: demoting the admins is how
    // you take a tenant over, not how you manage a customer.
    expect(ask(ADVISOR, ['advisor'], 'admin', 'lead')).toBe('requires-admin');
    expect(ask(ADVISOR, ['advisor'], 'advisor', 'client')).toBe('requires-admin');
  });

  it('lets an admin assign anything', () => {
    expect(ask(ADMIN, ['admin'], 'lead', 'admin')).toBeNull();
    expect(ask(ADMIN, ['admin'], 'advisor', 'lead')).toBeNull();
    expect(ask(ADMIN, ['admin'], 'client', 'knowledge_manager')).toBeNull();
  });

  it('refuses everyone else outright', () => {
    for (const role of ['visitor', 'lead', 'client', 'partner', 'knowledge_manager'] as Role[]) {
      expect(ask('someone', [role], 'lead', 'client')).toBe('not-permitted');
    }
    // No role at all is not a loophole either.
    expect(ask('someone', [], 'lead', 'client')).toBe('not-permitted');
  });

  it('refuses self-change, admins included', () => {
    /*
     * Both directions are hazards. Upward is self-promotion; downward is the
     * last admin demoting themselves, which leaves the tenant with nobody able
     * to promote anyone and no way back through the API.
     */
    expect(
      refuseRoleChange({
        actorId: TARGET,
        actorRoles: ['advisor'],
        targetId: TARGET,
        from: 'advisor',
        to: 'admin',
      }),
    ).toBe('self-change');

    expect(
      refuseRoleChange({
        actorId: TARGET,
        actorRoles: ['admin'],
        targetId: TARGET,
        from: 'admin',
        to: 'lead',
      }),
    ).toBe('self-change');
  });

  it('judges the actor by their highest privilege, not their first', () => {
    // Roles are a list. Someone holding both must not be judged by ordering.
    expect(ask('x', ['lead', 'admin'], 'lead', 'advisor')).toBeNull();
    expect(ask('x', ['client', 'advisor'], 'lead', 'client')).toBeNull();
  });
});
