import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  eventCatalog,
  type EventBus,
  type EventEnvelope,
  type EventHandler,
  type EventName,
  type EventPayload,
  type PublishOptions,
  type Unsubscribe,
} from '@anomalia/contracts';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * In-process EventBus adapter — the default for tests and local development.
 *
 * Two deliberate properties:
 *
 *  • Handlers are invoked AFTER the publisher's call resolves (`queueMicrotask`),
 *    so a slow or throwing subscriber can never affect the publisher. This
 *    mirrors the semantics of the Redis adapter, which means a module behaves
 *    identically under both and tests stay honest.
 *
 *  • A throwing handler is logged and isolated. One broken subscriber must not
 *    take down the other subscribers or the request that triggered them.
 */
@Injectable()
export class InMemoryEventBus implements EventBus {
  private readonly logger = new Logger(InMemoryEventBus.name);
  private readonly handlers = new Map<EventName, Set<EventHandler<never>>>();

  constructor(private readonly tenantContext: TenantContext) {}

  async publish<N extends EventName>(
    name: N,
    payload: EventPayload<N>,
    options: PublishOptions = {},
  ): Promise<void> {
    const envelope = buildEnvelope(name, payload, options, this.tenantContext, 'in-memory');
    const handlers = this.handlers.get(name);
    if (!handlers?.size) {
      this.logger.debug(`${name} published with no subscribers`);
      return;
    }
    for (const handler of handlers) {
      queueMicrotask(() => {
        void Promise.resolve()
          .then(() => (handler as EventHandler<N>)(envelope))
          .catch((error: unknown) => {
            this.logger.error(
              `subscriber for "${name}" threw (event ${envelope.id}, trace ${envelope.traceId})`,
              error instanceof Error ? error.stack : String(error),
            );
          });
      });
    }
  }

  subscribe<N extends EventName>(name: N, handler: EventHandler<N>): Unsubscribe {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as EventHandler<never>);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler as EventHandler<never>);
    };
  }

  /** Test affordance only. Never call from application code. */
  subscriberCount(name: EventName): number {
    return this.handlers.get(name)?.size ?? 0;
  }
}

/**
 * Builds and VALIDATES the envelope.
 *
 * Payloads are checked against the catalog at publish time. A producer with a
 * stale payload shape fails at its own call site, where the stack trace is
 * useful — rather than corrupting a consumer three services away.
 */
export function buildEnvelope<N extends EventName>(
  name: N,
  payload: EventPayload<N>,
  options: PublishOptions,
  tenantContext: TenantContext,
  source: string,
): EventEnvelope<N> {
  const schema = eventCatalog[name];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Refusing to publish "${name}": payload does not match the catalog.\n` +
        parsed.error.issues.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`).join('\n'),
    );
  }

  const tenantId = options.tenantId ?? tenantContext.requireTenantId();

  return {
    id: randomUUID(),
    name,
    payload: parsed.data as EventPayload<N>,
    tenantId,
    traceId: options.traceId ?? tenantContext.traceId(),
    ...(options.actorId ?? tenantContext.actorId() ? { actorId: options.actorId ?? tenantContext.actorId()! } : {}),
    source,
    occurredAt: new Date().toISOString(),
    schemaVersion: options.schemaVersion ?? 1,
  };
}
