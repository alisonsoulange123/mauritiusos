/**
 * Core's public surface for modules.
 *
 * A module should import from `@core/index` (or the specific file) and never
 * from another module. If something a module needs is missing here, it is a
 * cross-cutting concern that belongs in core — add it deliberately.
 */
export { CoreModule } from './core.module.js';
export { ConfigService } from './config/config.service.js';
export { DATABASE, type DatabaseRef } from './database/database.tokens.js';
export { ContractRegistry } from './contracts/contract-registry.js';
export { TenantContext, type RequestScope } from './tenancy/tenant-context.js';
export { AuditService, type AuditEntry } from './audit/audit.service.js';
export { IdempotencyGuard } from './events/idempotency.guard.js';
export { TokenService, type TokenPair } from './auth/token.service.js';
export { Public, Roles, CurrentActor, type AuthenticatedActor } from './auth/auth.decorators.js';
export { ZodValidationPipe, zodBody } from './http/zod-validation.pipe.js';
export { defineModule, type AnomaliaModuleDefinition } from './module-system/module.definition.js';
