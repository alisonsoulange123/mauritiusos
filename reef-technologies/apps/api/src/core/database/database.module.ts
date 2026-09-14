import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase } from '@reef-technologies/db';
import { ConfigService } from '../config/config.service.js';
import { DATABASE, type DatabaseRef } from './database.tokens.js';

/**
 * Owns the single connection pool for the process.
 *
 * Global because every module's repository needs it, and re-importing a
 * database module per feature is how you end up with twelve pools.
 * ConfigService comes from the global ConfigModule, so there is no import here.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DatabaseRef =>
        createDatabase({
          url: config.core.DATABASE_URL,
          poolMax: config.core.DATABASE_POOL_MAX,
          ssl: config.core.DATABASE_SSL,
          logQueries: config.core.LOG_LEVEL === 'debug',
        }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(DATABASE) private readonly database: DatabaseRef) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
    this.logger.log('connection pool drained');
  }
}
