import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/**
 * Validates request payloads against a Zod schema.
 *
 * Zod rather than class-validator because the same schema is reused by the
 * frontend and exported as JSON Schema for the Python worker — one definition,
 * three consumers. Failures are thrown as ZodError and shaped by the global
 * filter, so validation errors look identical across every module.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) throw new ZodError(result.error.issues);
    // Returns the PARSED value: defaults applied, types coerced, unknown keys
    // stripped. Never let the raw body past this line.
    return result.data;
  }
}

/** `@Body(zodBody(createItemSchema))` reads better at the call site. */
export const zodBody = (schema: ZodType) => new ZodValidationPipe(schema);
