import { z } from 'zod';
import { pageQuerySchema } from '@reef-technologies/contracts';

/**
 * Zod schemas double as validators and as the OpenAPI source of truth, so the
 * documented contract cannot drift from the enforced one.
 */

export const createSampleItemSchema = z.object({
  title: z.string().min(3).max(140).describe('Human-readable item title'),
  notes: z.string().max(2000).optional(),
});
export type CreateSampleItemDto = z.infer<typeof createSampleItemSchema>;

export const listSampleItemsSchema = pageQuerySchema;

export const sampleItemResponseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  status: z.enum(['draft', 'active', 'archived']),
  ownerId: z.string(),
  createdAt: z.string().datetime(),
});
export type SampleItemResponseDto = z.infer<typeof sampleItemResponseSchema>;
