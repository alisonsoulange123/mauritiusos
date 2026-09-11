import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { EVENT_BUS, type EventBus, type EventEnvelope } from '@anomalia/contracts';
import { IdempotencyGuard } from '../../../core/events/idempotency.guard.js';

/**
 * The asynchronous half of the Node ↔ Python boundary.
 *
 * `ai.plan.requested` goes out on the bus; the Python worker picks it up from
 * the Redis stream, does the long LangGraph run, and publishes
 * `ai.plan.generated` back. Neither side holds an HTTP connection open for
 * minutes, and a worker restart mid-run loses nothing — the request is still
 * pending in the stream.
 */
@Injectable()
export class AiConciergeSubscribers implements OnModuleInit {
  private readonly logger = new Logger(AiConciergeSubscribers.name);

  constructor(
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly idempotency: IdempotencyGuard,
  ) {}

  onModuleInit(): void {
    this.events.subscribe('ai.plan.generated', (envelope) => this.onPlanGenerated(envelope));
    this.events.subscribe('knowledge.item.published', (envelope) =>
      this.onKnowledgePublished(envelope),
    );
  }

  private async onPlanGenerated(envelope: EventEnvelope<'ai.plan.generated'>): Promise<void> {
    await this.idempotency.once(envelope, 'ai-concierge.on-plan-generated', async () => {
      if (envelope.payload.requiresHumanReview) {
        // Low confidence: an advisor reviews before the client sees it (§17).
        this.logger.warn(
          `plan ${envelope.payload.planId} needs advisor review (confidence ${envelope.payload.confidence})`,
        );
      }
      this.logger.log(
        `plan ${envelope.payload.planId} ready for user ${envelope.payload.userId} (${envelope.payload.steps.length} steps)`,
      );
    });
  }

  private async onKnowledgePublished(
    envelope: EventEnvelope<'knowledge.item.published'>,
  ): Promise<void> {
    // Nothing to do on this side: the Python worker consumes the same event
    // and does the embedding. The subscription exists so the topology endpoint
    // reflects that this module cares about knowledge freshness.
    this.logger.debug(`knowledge ${envelope.payload.slug} published; worker will re-embed`);
  }
}
