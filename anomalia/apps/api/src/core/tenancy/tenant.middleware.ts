import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { TenantContext } from './tenant-context.js';
import { TenantResolver } from './tenant.resolver.js';
import { ConfigService } from '../config/config.service.js';

/**
 * Opens the request scope. Runs before every guard, controller and repository,
 * so nothing downstream can execute outside a tenant.
 *
 * Resolution order — host first, because a custom domain is the strongest
 * signal and cannot be spoofed by a client header:
 *   1. Host          portal.mauritius.anomalia.io
 *   2. X-Anomalia-Tenant header (trusted service-to-service calls only)
 *   3. DEFAULT_TENANT_SLUG, and only when TENANT_STRICT is off
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    private readonly tenantContext: TenantContext,
    private readonly resolver: TenantResolver,
    private readonly config: ConfigService,
  ) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    const traceId = resolveTraceId(request);

    response.setHeader('x-trace-id', traceId);

    const slugFromHost = this.resolver.slugFromHost(request.hostname);
    const slugFromHeader = request.headers['x-anomalia-tenant'] as string | undefined;
    const slug = slugFromHost ?? slugFromHeader ?? this.config.core.DEFAULT_TENANT_SLUG;

    const tenant = await this.resolver.resolve(slug);

    if (!tenant && this.rejectUnresolvedTenant(response, slug, traceId)) return;

    this.tenantContext.run(
      {
        tenantId: tenant?.id ?? '00000000-0000-0000-0000-000000000000',
        tenantSlug: tenant?.slug ?? slug,
        traceId,
        roles: [],
        locale: this.resolver.negotiateLocale(request.headers['accept-language'], tenant?.defaultLocale),
      },
      () => next(),
    );
  }

  /**
   * Fail closed: an unresolvable tenant is rejected rather than allowed
   * through, because a query with no tenant filter is a cross-tenant leak.
   * Returns true when the response has been sent.
   */
  private rejectUnresolvedTenant(response: Response, slug: string, traceId: string): boolean {
    if (!this.config.core.TENANT_STRICT) {
      this.logger.warn(`unresolved tenant "${slug}"; continuing because TENANT_STRICT is off`);
      return false;
    }
    response.status(400).json({
      success: false,
      error: { code: 'TENANT_MISSING', message: `Unknown tenant "${slug}".` },
      traceId,
    });
    return true;
  }
}

/**
 * Honours an inbound trace id so a single trace spans the frontend, this API
 * and the Python worker. W3C `traceparent` takes the form
 * `00-<trace-id>-<span-id>-<flags>`; field 1 is the trace id.
 */
function resolveTraceId(request: Request): string {
  const explicit = request.headers['x-trace-id'];
  if (typeof explicit === 'string' && explicit.length > 0) return explicit;

  const traceparent = request.headers['traceparent'];
  if (typeof traceparent === 'string') {
    const traceId = traceparent.split('-')[1];
    if (traceId) return traceId;
  }
  return randomUUID();
}
