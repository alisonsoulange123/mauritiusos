import { Global, Module } from '@nestjs/common';
import { hostname } from 'node:os';
import { EVENT_BUS } from '@anomalia/contracts';
import { ConfigService } from '../config/config.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';
import { RedisEventBus } from './redis-event-bus.js';
import { IdempotencyGuard } from './idempotency.guard.js';
import { DATABASE, type DatabaseRef } from '../database/database.tokens.js';

/**
 * Selects the bus adapter from configuration.
 *
 * This is the hexagonal port/adapter swap in one factory: modules depend on
 * the `EVENT_BUS` token typed as `EventBus`, and whether that is an in-process
 * emitter or Redis Streams is a deployment decision, not a code change. Tests
 * get the in-memory bus and run with no infrastructure at all.
 */
@Global()
@Module({
  providers: [
    {
      provide: EVENT_BUS,
      inject: [ConfigService, TenantContext],
      useFactory: (config: ConfigService, tenantContext: TenantContext) => {
        if (config.core.EVENT_BUS_DRIVER === 'memory') {
          return new InMemoryEventBus(tenantContext);
        }
        return new RedisEventBus(
          {
            url: config.core.REDIS_URL,
            streamPrefix: config.core.EVENT_STREAM_PREFIX,
            consumerGroup: config.core.EVENT_CONSUMER_GROUP,
            // Distinct per replica so consumer-group claims do not collide.
            consumerName: `${config.core.APP_NAME}@${hostname()}:${process.pid}`,
          },
          tenantContext,
        );
      },
    },
    {
      provide: IdempotencyGuard,
      inject: [DATABASE],
      useFactory: (database: DatabaseRef) => new IdempotencyGuard(database),
    },
  ],
  exports: [EVENT_BUS, IdempotencyGuard],
})
export class EventsModule {}
