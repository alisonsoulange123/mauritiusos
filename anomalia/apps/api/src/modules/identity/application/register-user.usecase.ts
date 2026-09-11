import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { DomainError, EVENT_BUS, type EventBus } from '@anomalia/contracts';
import { and, eq } from 'drizzle-orm';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { users, userProfiles } from '../infrastructure/identity.schema.js';

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
    private readonly config: ConfigService,
  ) {}

  async execute(input: RegisterUserInput): Promise<{ userId: string }> {
    const tenantId = this.tenantContext.requireTenantId();
    const email = input.email.trim().toLowerCase();
    const { IDENTITY_PASSWORD_MIN_LENGTH, IDENTITY_ARGON_MEMORY_KIB } = this.config.module<{
      IDENTITY_PASSWORD_MIN_LENGTH: number;
      IDENTITY_ARGON_MEMORY_KIB: number;
    }>();

    if (input.password.length < IDENTITY_PASSWORD_MIN_LENGTH) {
      throw new DomainError(
        'IDENTITY_PASSWORD_TOO_SHORT',
        `Password must be at least ${IDENTITY_PASSWORD_MIN_LENGTH} characters.`,
        422,
      );
    }

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
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: IDENTITY_ARGON_MEMORY_KIB,
      timeCost: 3,
      parallelism: 4,
    });

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

    await this.events.publish('identity.user.registered', {
      userId,
      email,
      locale: input.locale,
      ...(input.acquisitionSource ? { source: input.acquisitionSource } : {}),
    });

    return { userId };
  }
}
