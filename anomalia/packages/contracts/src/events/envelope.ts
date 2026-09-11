import { z } from 'zod';

/**
 * Every event on the bus is wrapped in this envelope. The envelope — not the
 * payload — carries the cross-cutting concerns, which is what lets the bus
 * swap between in-process, Redis Streams and (later) a real broker without a
 * single domain module changing.
 */
export const eventEnvelopeSchema = z.object({
  /** Idempotency key. Consumers MUST tolerate redelivery of the same id. */
  id: z.string().uuid(),
  name: z.string().min(1),
  /** Payload shape is validated separately against the catalog entry. */
  payload: z.unknown(),
  /** Tenant isolation travels with the event (Security blueprint §18). */
  tenantId: z.string().uuid(),
  /** Correlates the event with the HTTP request that caused it. */
  traceId: z.string().min(1),
  /** Who triggered it; absent for system-generated events. */
  actorId: z.string().uuid().optional(),
  /** Module key that published it — for observability, never for routing. */
  source: z.string().min(1),
  occurredAt: z.string().datetime(),
  /** Bumped when a payload shape changes incompatibly. */
  schemaVersion: z.number().int().positive().default(1),
});

export type EventEnvelopeBase = z.infer<typeof eventEnvelopeSchema>;
