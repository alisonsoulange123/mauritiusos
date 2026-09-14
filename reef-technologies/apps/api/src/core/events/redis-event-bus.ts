import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import {
  eventCatalog,
  isEventName,
  type EventBus,
  type EventEnvelope,
  type EventHandler,
  type EventName,
  type EventPayload,
  type PublishOptions,
  type Unsubscribe,
} from '@reef-technologies/contracts';
import { TenantContext } from '../tenancy/tenant-context.js';
import { buildEnvelope } from './in-memory-event-bus.js';

export interface RedisEventBusOptions {
  url: string;
  streamPrefix: string;
  consumerGroup: string;
  consumerName: string;
}

/**
 * Redis Streams EventBus adapter — the production driver, and the seam along
 * which this modular monolith becomes microservices.
 *
 * Streams rather than pub/sub, for three reasons that matter operationally:
 *
 *  • Durability. Pub/sub drops messages when no subscriber is connected; a
 *    deploy would silently lose every event in flight.
 *  • Consumer groups. Several API replicas share one logical subscription
 *    instead of each processing the same event.
 *  • Replay + dead-lettering. Unacknowledged entries stay in the pending list,
 *    so a crashed consumer's work is recoverable rather than gone.
 *
 * The Python AI worker reads the SAME streams with its own consumer group,
 * which is how the Node/Python boundary is crossed without either side calling
 * the other.
 */
@Injectable()
export class RedisEventBus implements EventBus, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RedisEventBus.name);
  private readonly publisher: Redis;
  private readonly consumer: Redis;
  private readonly handlers = new Map<EventName, Set<EventHandler<never>>>();
  private running = false;

  constructor(
    private readonly options: RedisEventBusOptions,
    private readonly tenantContext: TenantContext,
  ) {
    // Separate connections: a blocking XREADGROUP would stall publishes.
    this.publisher = new Redis(options.url, { maxRetriesPerRequest: 3 });
    this.consumer = new Redis(options.url, { maxRetriesPerRequest: null });
  }

  private streamKey(name: EventName): string {
    return `${this.options.streamPrefix}:${name}`;
  }

  async publish<N extends EventName>(
    name: N,
    payload: EventPayload<N>,
    options: PublishOptions = {},
  ): Promise<void> {
    const envelope = buildEnvelope(name, payload, options, this.tenantContext, 'redis');
    await this.publisher.xadd(
      this.streamKey(name),
      '*',
      'envelope',
      JSON.stringify(envelope),
    );
    this.logger.debug(`published ${name} (${envelope.id})`);
  }

  subscribe<N extends EventName>(name: N, handler: EventHandler<N>): Unsubscribe {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as EventHandler<never>);
    this.handlers.set(name, set);
    return () => {
      set.delete(handler as EventHandler<never>);
    };
  }

  /**
   * Starts consuming AFTER every module has registered its subscriptions.
   *
   * This must not be `onModuleInit`. Nest runs core's onModuleInit before the
   * feature modules that call `subscribe()`, so the handler map would still be
   * empty: no consumer groups would be created and the loop would exit
   * immediately, silently dropping every inbound event.
   * `onApplicationBootstrap` runs after all onModuleInit hooks, so by here the
   * subscriptions are complete.
   */
  async onApplicationBootstrap(): Promise<void> {
    // Groups are created lazily per subscribed stream; BUSYGROUP means another
    // replica won the race, which is the expected happy path on redeploy.
    for (const name of this.handlers.keys()) {
      try {
        await this.consumer.xgroup('CREATE', this.streamKey(name), this.options.consumerGroup, '$', 'MKSTREAM');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) throw error;
      }
    }
    this.running = true;
    void this.consumeLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await Promise.allSettled([this.publisher.quit(), this.consumer.quit()]);
  }

  /**
   * Long-poll loop. Blocks for 5s at a time so shutdown stays responsive and
   * an idle process makes no requests.
   */
  private async consumeLoop(): Promise<void> {
    const streams = [...this.handlers.keys()];
    if (!streams.length) return;

    while (this.running) {
      try {
        const response = await this.consumer.xreadgroup(
          'GROUP',
          this.options.consumerGroup,
          this.options.consumerName,
          'COUNT',
          16,
          'BLOCK',
          5000,
          'STREAMS',
          ...streams.map((name) => this.streamKey(name)),
          ...streams.map(() => '>'),
        );
        if (!response) continue;

        for (const [streamKey, entries] of response as Array<[string, Array<[string, string[]]>]>) {
          for (const [entryId, fields] of entries) {
            await this.dispatch(streamKey, entryId, fields);
          }
        }
      } catch (error) {
        if (!this.running) return;
        this.logger.error('consume loop error; backing off 1s', error instanceof Error ? error.stack : String(error));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async dispatch(streamKey: string, entryId: string, fields: string[]): Promise<void> {
    const payloadIndex = fields.indexOf('envelope');
    const raw = payloadIndex >= 0 ? fields[payloadIndex + 1] : undefined;
    if (!raw) {
      await this.ack(streamKey, entryId);
      return;
    }

    let envelope: EventEnvelope;
    try {
      envelope = JSON.parse(raw) as EventEnvelope;
    } catch {
      // Unparseable entries are acknowledged; retrying cannot help.
      this.logger.error(`dropping malformed entry ${entryId} on ${streamKey}`);
      await this.ack(streamKey, entryId);
      return;
    }

    if (!isEventName(envelope.name)) {
      this.logger.warn(`ignoring unknown event "${envelope.name}" — producer is ahead of this deploy`);
      await this.ack(streamKey, entryId);
      return;
    }

    // Re-validate on the consuming side: the producer may be an older deploy.
    const parsed = eventCatalog[envelope.name].safeParse(envelope.payload);
    if (!parsed.success) {
      this.logger.error(`schema mismatch on "${envelope.name}" (${envelope.id}); left pending for inspection`);
      return; // No ACK -> stays in the pending list as a dead letter.
    }

    const handlers = this.handlers.get(envelope.name);
    const results = await Promise.allSettled(
      [...(handlers ?? [])].map((handler) => (handler as EventHandler<EventName>)(envelope)),
    );

    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length) {
      // Partial failure: do not ACK. Redis redelivers, and handlers are
      // required to be idempotent on `envelope.id`.
      this.logger.error(`${failed.length} handler(s) failed for ${envelope.name} (${envelope.id}); will redeliver`);
      return;
    }
    await this.ack(streamKey, entryId);
  }

  private async ack(streamKey: string, entryId: string): Promise<void> {
    await this.consumer.xack(streamKey, this.options.consumerGroup, entryId);
  }
}
