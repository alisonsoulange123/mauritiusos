import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseRef } from '../database/database.tokens.js';
import { processedEvents } from '../database/core.schema.js';
import type { EventEnvelope, EventName } from '@reef-technologies/contracts';

/**
 * Makes at-least-once delivery safe to build on.
 *
 * Redis Streams redeliver on any un-ACKed entry, so a handler WILL see the
 * same event twice — after a crash, a deploy mid-flight, or a partial handler
 * failure. Rather than asking every subscriber to invent its own protection,
 * handlers wrap their work in `once()` and the ledger enforces exactly-once
 * *effects* via a unique constraint on (event_id, consumer).
 *
 * Usage inside a subscriber:
 *
 *   await this.idempotency.once(envelope, 'assessment.on-eligibility', async () => {
 *     await this.repository.recordOutcome(envelope.payload);
 *   });
 */
@Injectable()
export class IdempotencyGuard {
  private readonly logger = new Logger(IdempotencyGuard.name);

  constructor(private readonly database: DatabaseRef) {}

  async once<N extends EventName, T>(
    envelope: EventEnvelope<N>,
    consumer: string,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    // Claim first, inside the same transaction as the work. If the work
    // throws, the claim rolls back with it and redelivery retries cleanly.
    return this.database.runAsTenant(envelope.tenantId, async (tx) => {
      const claimed = await tx
        .insert(processedEvents)
        .values({
          eventId: envelope.id,
          eventName: envelope.name,
          consumer,
          tenantId: envelope.tenantId,
        })
        .onConflictDoNothing({ target: [processedEvents.eventId, processedEvents.consumer] })
        .returning({ eventId: processedEvents.eventId });

      if (!claimed.length) {
        this.logger.debug(`skipping duplicate ${envelope.name} (${envelope.id}) for ${consumer}`);
        return undefined;
      }

      return work();
    });
  }

  /** Ops helper: prune the ledger. Schedule beyond the stream retention window. */
  async prune(olderThanDays = 30): Promise<number> {
    const result = await this.database.db.execute(
      sql`DELETE FROM ${processedEvents} WHERE processed_at < now() - (${olderThanDays} || ' days')::interval`,
    );
    return result.rowCount ?? 0;
  }
}
