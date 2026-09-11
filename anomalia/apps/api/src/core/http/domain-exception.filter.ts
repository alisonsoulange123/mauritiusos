import type {
  ArgumentsHost} from '@nestjs/common';
import {
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { DomainError, ERROR_CODES, type ApiError } from '@anomalia/contracts';
import { TenantContext } from '../tenancy/tenant-context.js';

/**
 * The single exit point for every error in the platform.
 *
 * Registered globally, so a module author cannot accidentally leak a stack
 * trace or invent a fourth error shape. Three guarantees:
 *
 *   1. One response envelope (Engineering Standards §14) — the frontend needs
 *      exactly one error handler.
 *   2. Every response carries the traceId, so a user-reported error maps
 *      straight to a log line.
 *   3. Unexpected errors are logged in full and reported as a bare 500. Nobody
 *      outside learns our table names from a Postgres error string.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  constructor(private readonly tenantContext: TenantContext) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const traceId = this.tenantContext.traceId();
    const { status, body } = this.translate(exception, traceId);

    if (status >= 500) {
      this.logger.error(
        `${body.error.code} (trace ${traceId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${status} ${body.error.code} (trace ${traceId})`);
    }

    response.status(status).json(body);
  }

  private translate(exception: unknown, traceId: string): { status: number; body: ApiError } {
    // Domain errors are intentional and safe to surface verbatim.
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        body: {
          success: false,
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
          },
          traceId,
        },
      };
    }

    // Validation: report every offending field at once, not just the first.
    if (exception instanceof ZodError) {
      return {
        status: 422,
        body: {
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_FAILED,
            message: 'Request payload failed validation.',
            details: exception.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
          traceId,
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message = typeof payload === 'string' ? payload : ((payload as { message?: string }).message ?? exception.message);
      return {
        status,
        body: {
          success: false,
          error: { code: httpCodeFor(status), message },
          traceId,
        },
      };
    }

    // Anything else is a bug. Say nothing useful to the caller.
    return {
      status: 500,
      body: {
        success: false,
        error: { code: ERROR_CODES.INTERNAL, message: 'An unexpected error occurred.' },
        traceId,
      },
    };
  }
}

const httpCodeFor = (status: number): string =>
  ({
    400: 'BAD_REQUEST',
    401: ERROR_CODES.UNAUTHENTICATED,
    403: ERROR_CODES.FORBIDDEN,
    404: ERROR_CODES.NOT_FOUND,
    409: 'CONFLICT',
    422: ERROR_CODES.VALIDATION_FAILED,
    429: ERROR_CODES.RATE_LIMITED,
  })[status] ?? ERROR_CODES.INTERNAL;
