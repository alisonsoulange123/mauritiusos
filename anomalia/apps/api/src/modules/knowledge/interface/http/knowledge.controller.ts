import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KNOWLEDGE_CONTRACT } from '@anomalia/contracts';
import { ContractRegistry } from '../../../../core/contracts/contract-registry.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { Public } from '../../../../core/auth/auth.decorators.js';

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  category: z.string().max(60).optional(),
  language: z.enum(['en', 'fr']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** `GET /knowledge/search` from the API Contract Blueprint §8.1. */
@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly contracts: ContractRegistry) {}

  // Public: the knowledge explorer is a trust-building acquisition surface.
  // Only published, verified, confidence-gated items are ever returned.
  @Public()
  @Get('search')
  @ApiOperation({ summary: 'Search verified knowledge' })
  async search(@Query(zodBody(searchSchema)) query: z.infer<typeof searchSchema>) {
    const knowledge = this.contracts.get(KNOWLEDGE_CONTRACT);
    return knowledge.search({
      query: query.q,
      ...(query.category ? { category: query.category } : {}),
      ...(query.language ? { locale: query.language } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    });
  }
}
