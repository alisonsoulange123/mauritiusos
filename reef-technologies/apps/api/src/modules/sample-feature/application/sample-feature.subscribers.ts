import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, type EventBus, type EventEnvelope } from '@reef-technologies/contracts';
import { IdempotencyGuard } from '../../../core/events/idempotency.guard.js';
import { CreateSampleItemUseCase } from './create-sample-item.usecase.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

/**
 * INBOUND event handling — the receiving half of inter-module communication.
 *
 * This module reacts to `identity.user.registered` without importing anything
 * from the identity module, and identity has no idea this subscriber exists.
 * Either module can be deleted and the other still boots.
 *
 * Three rules every subscriber must follow, all visible below:
 *
 *  1. IDEMPOTENCY. Delivery is at-least-once, so `IdempotencyGuard.once()`
 *     wraps the effect. Without it, a redelivery after a deploy duplicates
 *     work — the classic "the customer got charged twice" bug.
 *
 *  2. RE-ESTABLISH THE SCOPE. A handler runs outside any HTTP request, so
 *     there is no ambient tenant. The envelope carries it; we open a scope
 *     from the envelope so repositories keep working unchanged.
 *
 *  3. NEVER THROW FOR BUSINESS REASONS. Throw only for transient failures
 *     worth a retry. A permanent problem must be logged and swallowed, or
 *     Redis will redeliver it forever.
 */
@Injectable()
export class SampleFeatureSubscribers implements OnModuleInit {
  private readonly logger = new Logger(SampleFeatureSubscribers.name);

  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly idempotency: IdempotencyGuard,
    private readonly tenantContext: TenantContext,
    private readonly createItem: CreateSampleItemUseCase,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('identity.user.registered', (envelope) =>
      this.onUserRegistered(envelope),
    );
  }

  private async onUserRegistered(
    envelope: EventEnvelope<'identity.user.registered'>,
  ): Promise<void> {
    await this.idempotency.once(envelope, 'sample-feature.on-user-registered', async () => {
      // Rebuild the request scope from the envelope — see rule 2 above.
      await this.tenantContext.run(
        {
          tenantId: envelope.tenantId,
          tenantSlug: 'event',
          traceId: envelope.traceId,
          ...(envelope.actorId ? { actorId: envelope.actorId } : {}),
          roles: ['system'],
          locale: envelope.payload.locale,
        },
        async () => {
          try {
            await this.createItem.execute({
              title: `Welcome checklist for ${envelope.payload.email}`,
              ownerId: envelope.payload.userId,
            });
          } catch (error) {
            // Permanent failure (a duplicate title, say): log and move on.
            // Rethrowing would loop forever. See rule 3.
            this.logger.warn(
              `could not seed welcome item for ${envelope.payload.userId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      );
    });
  }
}
