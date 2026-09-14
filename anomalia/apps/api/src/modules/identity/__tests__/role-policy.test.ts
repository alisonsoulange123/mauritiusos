import { describe, expect, it } from 'vitest';
import type { Role } from '@anomalia/contracts';
import { refuseRoleChange } from '../domain/role-policy.js';

const ADMIN = 'admin-1';
const ADVISOR = 'advisor-1';
const TARGET = 'target-1';

/** Targets are verified unless a test is specifically about verification. */
const ask = (actorId: string, actorRoles: Role[], from: Role, to: Role) =>
  refuseRoleChange({
    actorId,
    actorRoles,
    targetId: TARGET,
    from,
    to,
    targetEmailVerified: true,
  });

const askUnverified = (actorId: string, actorRoles: Role[], from: Role, to: Role) =>
  refuseRoleChange({
    actorId,
    actorRoles,
    targetId: TARGET,
    from,
    to,
    targetEmailVerified: false,
  });

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
        targetEmailVerified: true,
      }),
    ).toBe('self-change');

    expect(
      refuseRoleChange({
        actorId: TARGET,
        actorRoles: ['admin'],
        targetId: TARGET,
        from: 'admin',
        to: 'lead',
        targetEmailVerified: true,
      }),
    ).toBe('self-change');
  });

  it('judges the actor by their highest privilege, not their first', () => {
    // Roles are a list. Someone holding both must not be judged by ordering.
    expect(ask('x', ['lead', 'admin'], 'lead', 'advisor')).toBeNull();
    expect(ask('x', ['client', 'advisor'], 'lead', 'client')).toBeNull();
  });

  it('will not promote an account whose address is unconfirmed', () => {
    // The paid tier is granted to a person. An unconfirmed address is a string
    // somebody typed, which may well be somebody else's.
    expect(askUnverified(ADVISOR, ['advisor'], 'lead', 'client')).toBe('unverified-email');
    expect(askUnverified(ADMIN, ['admin'], 'lead', 'advisor')).toBe('unverified-email');
  });

  it('applies the verification rule to admins too', () => {
    // Not an authority check: no amount of privilege turns an unconfirmed
    // address into a confirmed one.
    expect(askUnverified(ADMIN, ['admin'], 'lead', 'admin')).toBe('unverified-email');
  });

  it('still allows movement inside the unverified ceiling', () => {
    // `visitor` and `lead` are what an unproven identity is worth, so moving
    // between them stays possible — otherwise a mistaken promotion could never
    // be undone for an account that never confirmed.
    expect(askUnverified(ADVISOR, ['advisor'], 'lead', 'visitor')).toBeNull();
    expect(askUnverified(ADVISOR, ['advisor'], 'visitor', 'lead')).toBeNull();
  });

  it('demotes an unverified client back down without complaint', () => {
    // The account was promoted before the rule existed, or verification was
    // later revoked. Removing privilege must never be blocked by the same
    // check that guards granting it.
    expect(askUnverified(ADVISOR, ['advisor'], 'client', 'lead')).toBeNull();
    expect(askUnverified(ADMIN, ['admin'], 'advisor', 'lead')).toBeNull();
  });

  it('checks authority before verification', () => {
    // Someone with no standing gets the refusal that reflects their standing,
    // not a hint about the target's account state.
    expect(askUnverified('nobody', ['lead'], 'lead', 'client')).toBe('not-permitted');
    // An advisor reaching outside the ladder is told that, not told about the
    // target's mailbox.
    expect(askUnverified(ADVISOR, ['advisor'], 'lead', 'advisor')).toBe('requires-admin');
  });
});
