import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DomainError, ERROR_CODES, EVENT_BUS, type EventBus, type Role } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { AuditService } from '../../../core/audit/audit.service.js';
import { SessionRegistry } from '../../../core/auth/session-registry.js';
import { refuseRoleChange, type RoleChangeRefusal } from '../domain/role-policy.js';
import { users } from '../infrastructure/identity.schema.js';

export interface ChangeUserRoleInput {
  targetUserId: string;
  role: Role;
  actorId: string;
  actorRoles: Role[];
}

export interface ChangeUserRoleResult {
  userId: string;
  from: Role;
  to: Role;
  /** How many sessions were ended so the new role takes effect at once. */
  sessionsRevoked: number;
}

/**
 * Moves an account between roles — in practice, `lead` → `client`.
 *
 * This closes a dead end rather than adding a feature: registration issues
 * `lead`, the concierge requires `client`, and until now nothing in the
 * platform could bridge the two. Every account ever created was stuck.
 */
@Injectable()
export class ChangeUserRoleUseCase {
  private readonly logger = new Logger(ChangeUserRoleUseCase.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly sessions: SessionRegistry,
    private readonly audit: AuditService,
  ) {}

  async execute(input: ChangeUserRoleInput): Promise<ChangeUserRoleResult> {
    const tenantId = this.tenantContext.requireTenantId();

    // Tenant-scoped read: a user in another tenant is not "forbidden", it is
    // not found, because confirming the id exists is itself a disclosure.
    const rows = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, input.targetUserId)))
      .limit(1);

    const target = rows[0];
    if (!target) {
      throw new DomainError(ERROR_CODES.NOT_FOUND, 'No such user.', 404);
    }

    const refusal = refuseRoleChange({
      actorId: input.actorId,
      actorRoles: input.actorRoles,
      targetId: target.id,
      from: target.role,
      to: input.role,
      targetEmailVerified: target.emailVerifiedAt !== null,
    });

    if (refusal) await this.refuse(refusal, input, target.role);

    // Idempotent: re-issuing the same role is a no-op rather than a spurious
    // event and a gratuitous sign-out of every device the user owns.
    if (target.role === input.role) {
      return { userId: target.id, from: target.role, to: input.role, sessionsRevoked: 0 };
    }

    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx
        .update(users)
        .set({ role: input.role })
        .where(and(eq(users.tenantId, tenantId), eq(users.id, target.id)));
    });

    /*
     * Roles are baked into the access token, so the database alone does not
     * decide what a live session may do. Ending the account's sessions is what
     * makes the change take effect now, and it matters in both directions:
     *
     *   demotion  — otherwise the revoked privilege survives up to a full
     *               access TTL, which is a real authorization hole;
     *   promotion — otherwise the customer pays and the concierge stays
     *               locked for fifteen minutes with no explanation.
     *
     * The cost is one sign-in after a rare administrative action, which is
     * both predictable and, for an upgrade, unsurprising.
     */
    const sessionsRevoked = await this.sessions.revokeAllForUser(tenantId, target.id);

    await this.audit.record({
      action: 'identity.role.changed',
      resourceType: 'user',
      resourceId: target.id,
      metadata: { from: target.role, to: input.role, changedBy: input.actorId, sessionsRevoked },
    });

    // The event the module has always declared it publishes. Other modules
    // learn about entitlement changes here rather than reading identity's
    // tables, which is the whole point of the bus.
    await this.events.publish('identity.role.changed', {
      userId: target.id,
      from: target.role,
      to: input.role,
      changedBy: input.actorId,
    });

    this.logger.log(
      `role ${target.role} -> ${input.role} for ${target.id} by ${input.actorId} ` +
        `(${sessionsRevoked} session(s) ended)`,
    );

    return { userId: target.id, from: target.role, to: input.role, sessionsRevoked };
  }

  /** Records the attempt before refusing it — a denied escalation is a signal. */
  private async refuse(
    refusal: RoleChangeRefusal,
    input: ChangeUserRoleInput,
    from: Role,
  ): Promise<never> {
    await this.audit.record({
      action: 'identity.role.change_denied',
      resourceType: 'user',
      resourceId: input.targetUserId,
      result: 'denied',
      metadata: { from, to: input.role, changedBy: input.actorId, reason: refusal },
    });

    const message = REFUSAL_MESSAGES[refusal];
    throw new DomainError(ERROR_CODES.FORBIDDEN, message, 403);
  }
}

const REFUSAL_MESSAGES: Record<RoleChangeRefusal, string> = {
  'self-change': 'You cannot change your own role.',
  'not-permitted': 'You are not permitted to change roles.',
  'requires-admin': 'Only an administrator can assign or remove that role.',
  // Names the remedy, because this one is fixable by the target in a minute
  // and the person reading it is usually an advisor mid-conversation.
  'unverified-email':
    'That account has not confirmed its email address yet, so it cannot be given this role.',
};
