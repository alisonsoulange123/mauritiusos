import { Global, Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import type { FlagSet, LoadedEnv } from '@reef-technologies/config';
import { ConfigModule } from './config/config.module.js';
import { ConfigService } from './config/config.service.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RedisModule } from './redis/redis.module.js';
import { MailModule } from './mail/mail.module.js';
import { ContractRegistry } from './contracts/contract-registry.js';
import { ContractVerifier } from './contracts/contract-verifier.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TenantMiddleware } from './tenancy/tenant.middleware.js';
import { DomainExceptionFilter } from './http/domain-exception.filter.js';
import { TraceInterceptor } from './http/trace.interceptor.js';
import { PlatformController } from './platform/platform.controller.js';
import { MODULE_MANIFEST, type ModuleManifest } from './module-system/module.definition.js';
import { AuditService } from './audit/audit.service.js';
import { AuditController } from './audit/audit.controller.js';

export interface CoreModuleOptions {
  env: LoadedEnv;
  flags: FlagSet;
  manifest: ModuleManifest;
}

/**
 * Everything that is true of the platform regardless of which modules are
 * installed: config, database, event bus, tenancy, auth, error handling,
 * audit, rate limiting.
 *
 * The critical property is the direction of dependency. CoreModule knows
 * NOTHING about `modules/` — it receives the manifest as data. That inversion
 * is why a module can be added or deleted without core changing, and it is
 * enforced mechanically by `scripts/check-boundaries.mjs`.
 */
@Global()
@Module({})
export class CoreModule implements NestModule {
  static forRoot(options: CoreModuleOptions): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        ConfigModule.forRoot(options.env, options.flags),
        // Before DatabaseModule and EventsModule: both resolve TenantContext.
        TenancyModule,
        DatabaseModule,
        EventsModule,
        // Before AuthModule: the session registry and guard both need the client.
        RedisModule,
        AuthModule,
        MailModule,
        /*
         * ONE named throttler, deliberately.
         *
         * Every throttler configured here is enforced on EVERY route — the
         * names select which one a `@Throttle()` decorator overrides, they do
         * not scope where it applies. A second `auth` bucket at 10/min was
         * therefore not "a tighter limit for credential endpoints"; it was a
         * 10/min ceiling on the entire API, which the credential routes then
         * redundantly re-declared for themselves.
         *
         * It went unnoticed because the frontend caches aggressively enough to
         * stay under it. Paging through the Back Office directory does not.
         *
         * So: one coarse bucket, and routes that need to be tighter override
         * `default` for themselves with a smaller limit.
         */
        ThrottlerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => ({
            throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
            /*
             * Off under NODE_ENV=test, and only there.
             *
             * An integration suite drives dozens of sign-ins from one source
             * address and would exhaust the credential bucket within a few
             * cases — failing for a reason none of those tests is about, and
             * doing it intermittently depending on how fast the machine ran.
             *
             * The suite that tests rate limiting boots with a different
             * NODE_ENV precisely so it faces the real limiter. Production sets
             * `production`, so this can never be reached there.
             */
            skipIf: () => config.isTest,
          }),
        }),
      ],
      controllers: [PlatformController, AuditController],
      providers: [
        { provide: MODULE_MANIFEST, useValue: options.manifest },
        ContractRegistry,
        ContractVerifier,
        AuditService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useClass: DomainExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TraceInterceptor },
      ],
      exports: [
        ContractRegistry,
        TenancyModule,
        AuditService,
        ConfigModule,
        EventsModule,
        // Before AuthModule: the session registry and guard both need the client.
        RedisModule,
        AuthModule,
        MailModule,
        MODULE_MANIFEST,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Applied to '*' so a module cannot opt out of tenant scoping.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
