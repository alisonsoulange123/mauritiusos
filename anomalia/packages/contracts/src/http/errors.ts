import { z } from 'zod';

/**
 * The single error envelope for the whole platform (Engineering Standards §14).
 * Every non-2xx response from every module has exactly this shape, so the
 * frontend needs one error handler, forever.
 */
export const apiErrorSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Field-level detail for validation failures. */
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
  traceId: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Stable, greppable codes. Modules add their own with a module-key prefix. */
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  TENANT_MISSING: 'TENANT_MISSING',
  CONTRACT_UNAVAILABLE: 'CONTRACT_UNAVAILABLE',
  MODULE_DISABLED: 'MODULE_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Thrown by domain code; mapped to HTTP by core/http/domain-exception.filter. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(ERROR_CODES.NOT_FOUND, `${resource} "${id}" not found.`, 404);
  }
}
