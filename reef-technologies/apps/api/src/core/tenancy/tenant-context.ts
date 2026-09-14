import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { DomainError, ERROR_CODES } from '@reef-technologies/contracts';

export interface RequestScope {
  tenantId: string;
  tenantSlug: string;
  traceId: string;
  actorId?: string;
  roles: string[];
  locale: string;
}

/**
 * Ambient request scope, carried by AsyncLocalStorage.
 *
 * Why not just pass it as a parameter? Because tenant id, trace id and actor
 * are needed by *every* repository, every event publish and every log line.
 * Threading them through every signature would put infrastructure concerns
 * into domain method arguments — exactly the coupling Clean Architecture is
 * meant to prevent. ALS keeps them ambient without making them global.
 *
 * `requireTenantId()` throws rather than returning a default. A query that
 * silently ran without a tenant filter is a cross-tenant data leak, so the
 * failure mode is a 500, not a wrong answer.
 */
@Injectable()
export class TenantContext {
  private readonly storage = new AsyncLocalStorage<RequestScope>();

  run<T>(scope: RequestScope, fn: () => T): T {
    return this.storage.run(scope, fn);
  }

  current(): RequestScope | undefined {
    return this.storage.getStore();
  }

  requireTenantId(): string {
    const scope = this.storage.getStore();
    if (!scope?.tenantId) {
      throw new DomainError(
        ERROR_CODES.TENANT_MISSING,
        'No tenant in scope. Every data access must run inside a tenant-scoped request.',
        500,
      );
    }
    return scope.tenantId;
  }

  tenantSlug(): string | undefined {
    return this.storage.getStore()?.tenantSlug;
  }

  traceId(): string {
    return this.storage.getStore()?.traceId ?? randomUUID();
  }

  actorId(): string | undefined {
    return this.storage.getStore()?.actorId;
  }

  roles(): string[] {
    return this.storage.getStore()?.roles ?? [];
  }

  locale(): string {
    return this.storage.getStore()?.locale ?? 'en';
  }
}
