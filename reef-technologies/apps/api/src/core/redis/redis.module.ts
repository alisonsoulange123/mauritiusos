import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service.js';

/** DI token for the shared command connection. */
export const REDIS = Symbol.for('reef_technologies.core.Redis');

/**
 * One shared Redis connection for ordinary command traffic.
 *
 * Separate from the event bus's connections on purpose: that adapter holds two
 * of its own because `XREADGROUP` blocks, and a blocked socket cannot serve a
 * `GET`. This client is for short commands — session lookups, revocation
 * checks — and must never be given a blocking call.
 *
 * `@Global()` so any core concern can inject it without each one opening
 * another connection and multiplying the pool by the number of features.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.core.REDIS_URL, {
          /*
           * Fail fast rather than queue. These commands sit in the request
           * path, so a hung session lookup holds the response open while an
           * errored one can be decided on immediately — and the callers here
           * all have an explicit policy for what an unreachable Redis means.
           */
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Close cleanly so a deploy does not leave the server dropping sockets. */
  async onApplicationShutdown(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
    this.logger.log('redis command connection closed');
  }
}
