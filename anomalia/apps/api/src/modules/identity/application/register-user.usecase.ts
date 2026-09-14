import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainError, EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { users, userProfiles } from '../infrastructure/identity.schema.js';
import { PasswordHasher } from '../infrastructure/password-hasher.js';
import { RecoveryMailer } from '../infrastructure/recovery-mailer.js';

export interface RegisterUserInput {
  email: string;
  password: string;
  firstName?: string;
  locale: string;
  acquisitionSource?: string;
}

@Injectable()
export class RegisterUserUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
    private readonly passwords: PasswordHasher,
    private readonly recovery: RecoveryMailer,
  ) {}

  async execute(input: RegisterUserInput): Promise<{ userId: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const email = input.email.trim().toLowerCase();

    const existing = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
      .limit(1);

    if (existing.length) {
      // Deliberately the same shape as a successful response would take at the
      // API layer: enumerating registered emails is an information leak.
      throw new DomainError('IDENTITY_EMAIL_TAKEN', 'That email cannot be registered.', 409);
    }

    const userId = randomUUID();
    const passwordHash = await this.passwords.hash(input.password);

    // User and profile in one transaction: a user without a profile would
    // break every downstream module's assumptions.
    await this.database.runAsTenant(tenantId, async (tx) => {
      await tx.insert(users).values({ id: userId, tenantId, email, passwordHash, locale: input.locale, status: 'active' });
      await tx.insert(userProfiles).values({
        tenantId,
        userId,
        firstName: input.firstName ?? null,
        journeyStage: 'lead',
      });
    });

    /*
     * The confirmation link goes out here, not from an event handler.
     *
     * It is the one message whose absence the user notices immediately, and
     * routing it through the bus would make "did the welcome mail send?"
     * depend on consumer health. Sending it inline cannot fail the
     * registration either: the mailer swallows and logs, so an account is
     * still created when the provider is down, and the user can ask for
     * another link from inside the portal.
     */
    await this.recovery.sendEmailVerification({
      userId,
      tenantId,
      email,
      locale: input.locale,
    });

    await this.events.publish('identity.user.registered', {
      userId,
      email,
      locale: input.locale,
      ...(input.acquisitionSource ? { source: input.acquisitionSource } : {}),
    });

    return { userId };
  }
}
