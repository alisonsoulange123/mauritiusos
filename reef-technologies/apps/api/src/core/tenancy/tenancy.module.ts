import { Global, Module } from '@nestjs/common';
import { TenantContext } from './tenant-context.js';
import { TenantResolver } from './tenant.resolver.js';

/**
 * Owns the ONE TenantContext instance for the process.
 *
 * This must be a single provider in a single module. Registering
 * `TenantContext` in two modules makes Nest instantiate it twice, and then the
 * middleware opens a scope on one instance while repositories read from the
 * other — every request fails with TENANT_MISSING even though resolution
 * succeeded. A dedicated global module makes that mistake impossible to
 * reintroduce.
 */
@Global()
@Module({
  providers: [TenantContext, TenantResolver],
  exports: [TenantContext, TenantResolver],
})
export class TenancyModule {}
