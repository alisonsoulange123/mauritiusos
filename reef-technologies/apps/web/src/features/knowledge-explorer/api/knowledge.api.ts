import { z } from 'zod';
import { apiRequest } from '@/shared/api/client';

const hitSchema = z.object({
  knowledgeId: z.string(),
  title: z.string(),
  slug: z.string(),
  type: z.enum(['RULE', 'GUIDE', 'LOCATION', 'PROCESS', 'FAQ', 'DOCUMENT']),
  excerpt: z.string(),
  confidence: z.number(),
  sourceAuthority: z.enum(['official', 'partner', 'editorial', 'community']),
  lastVerifiedAt: z.string().nullable(),
});

export type KnowledgeHit = z.infer<typeof hitSchema>;

export const searchKnowledge = async (query: string, locale: string) =>
  z
    .array(hitSchema)
    .parse(
      await apiRequest(
        `/knowledge/search?q=${encodeURIComponent(query)}&language=${encodeURIComponent(locale)}`,
      ),
    );
