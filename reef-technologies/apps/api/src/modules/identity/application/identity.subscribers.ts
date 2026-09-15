import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, type EventBus, type EventEnvelope } from '@reef-technologies/contracts';
import { IdempotencyGuard } from '../../../core/events/idempotency.guard.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ManageProfileUseCase } from './manage-profile.usecase.js';

/**
 * Identity's ear on the bus.
 *
 * The assessment already collects nationality, occupation, income and family
 * status, and the immigration rules match on exactly those. Carrying them over
 * through an event rather than a contract call is deliberate: nobody is waiting
 * on it. The assessment returns its result whether or not the profile is ever
 * enriched, and a slow or failed enrichment must not make the funnel slower or
 * fail with it.
 */
@Injectable()
export class IdentitySubscribers implements OnModuleInit {
  private readonly logger = new Logger(IdentitySubscribers.name);

  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly idempotency: IdempotencyGuard,
    private readonly tenantContext: TenantContext,
    private readonly profiles: ManageProfileUseCase,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('assessment.completed', (envelope) => this.onCompleted(envelope));
  }

  private async onCompleted(envelope: EventEnvelope<'assessment.completed'>): Promise<void> {
    const { userId, profileSnapshot } = envelope.payload;

    // Assessments are deliberately open to anonymous visitors — that is the
    // top of the funnel. There is simply no profile to enrich yet.
    if (!userId) return;

    await this.idempotency.once(envelope, 'identity.enrich-profile', async () => {
      /*
       * The envelope carries the tenant; the handler runs outside any request,
       * so nothing else would set it. Without this the repository has no
       * tenant and — with row-level security in force — reads an empty table.
       */
      await this.tenantContext.run(
        {
          tenantId: envelope.tenantId,
          tenantSlug: '',
          traceId: envelope.traceId,
          // No actor and no roles: this is the platform reacting to something
          // that already happened, not a person acting. Leaving them empty
          // keeps the audit row honest about who did it.
          roles: [],
          locale: 'en',
        },
        () => this.profiles.enrichFromAssessment(userId, profileSnapshot),
      );

      this.logger.log(`profile enrichment considered for ${userId}`);
    });
  }
}
