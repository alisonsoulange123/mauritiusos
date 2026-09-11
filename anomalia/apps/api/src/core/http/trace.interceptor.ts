import type {
  CallHandler,
  ExecutionContext} from '@nestjs/common';
import {
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
import type { Request } from 'express';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * Structured access logging with the fields the Engineering Standards §16
 * require on every line: traceId, tenantId, userId, duration.
 *
 * One line per request, machine-parseable, and enough to answer "what did this
 * user see at 14:03" without attaching a debugger.
 */
@Injectable()
export class TraceInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');

  constructor(private readonly tenantContext: TenantContext) {}

  intercept(context: ExecutionContext, next: CallHandler): ReturnType<CallHandler['handle']> {
    const request = context.switchToHttp().getRequest<Request>();
    const startedAt = process.hrtime.bigint();
    const scope = this.tenantContext.current();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, scope, startedAt, 'ok'),
        error: () => this.log(request, scope, startedAt, 'error'),
      }),
    );
  }

  private log(
    request: Request,
    scope: ReturnType<TenantContext['current']>,
    startedAt: bigint,
    outcome: string,
  ): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    this.logger.log(
      JSON.stringify({
        method: request.method,
        // `route.path` not `url`: keeps ids out of log cardinality.
        path: (request.route as { path?: string } | undefined)?.path ?? request.path,
        outcome,
        durationMs: Math.round(durationMs * 100) / 100,
        traceId: scope?.traceId,
        tenantId: scope?.tenantId,
        userId: scope?.actorId,
      }),
    );
  }
}
