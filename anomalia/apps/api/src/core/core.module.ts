import { Global, Module, type DynamicModule, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import type { FlagSet, LoadedEnv } from '@anomalia/config';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { EventsModule } from './events/events.module.js';
import { AuthModule } from './auth/auth.module.js';
import { RedisModule } from './redis/redis.module.js';
import { ContractRegistry } from './contracts/contract-registry.js';
import { ContractVerifier } from './contracts/contract-verifier.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TenantMiddleware } from './tenancy/tenant.middleware.js';
import { DomainExceptionFilter } from './http/domain-exception.filter.js';
import { TraceInterceptor } from './http/trace.interceptor.js';
import { PlatformController } from './platform/platform.controller.js';
import { MODULE_MANIFEST, type ModuleManifest } from './module-system/module.definition.js';
import { AuditService } from './audit/audit.service.js';

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
        ThrottlerModule.forRoot([
          // Coarse default. Modules tighten it per route with @Throttle().
          { name: 'default', ttl: 60_000, limit: 120 },
          { name: 'auth', ttl: 60_000, limit: 10 },
        ]),
      ],
      controllers: [PlatformController],
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
        MODULE_MANIFEST,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Applied to '*' so a module cannot opt out of tenant scoping.
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
