import type { EventName, EventPayload } from './catalog';
import type { EventEnvelopeBase } from './envelope';

/** A fully typed envelope: the payload is narrowed by the event name. */
export interface EventEnvelope<N extends EventName = EventName>
  extends Omit<EventEnvelopeBase, 'name' | 'payload'> {
  name: N;
  payload: EventPayload<N>;
}

export interface PublishOptions {
  /** Overrides the ambient tenant — only system/ops code should need this. */
  tenantId?: string;
  actorId?: string;
  traceId?: string;
  schemaVersion?: number;
}

export type EventHandler<N extends EventName> = (envelope: EventEnvelope<N>) => void | Promise<void>;

export type Unsubscribe = () => void;

/**
 * The EventBus PORT (hexagonal). Modules depend on this interface only;
 * core/events supplies an adapter (in-process for dev and tests, Redis Streams
 * for production, a broker later) with no module-side change.
 */
export interface EventBus {
  publish<N extends EventName>(
    name: N,
    payload: EventPayload<N>,
    options?: PublishOptions,
  ): Promise<void>;

  subscribe<N extends EventName>(name: N, handler: EventHandler<N>): Unsubscribe;
}

/** DI token. A symbol so nothing can accidentally collide with it. */
export const EVENT_BUS = Symbol.for('anomalia.core.EventBus');
