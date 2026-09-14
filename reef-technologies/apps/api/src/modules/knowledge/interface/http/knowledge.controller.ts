import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { KNOWLEDGE_CONTRACT } from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../../core/contracts/contract-registry.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { Public, Roles } from '../../../../core/auth/auth.decorators.js';
import { AuthorKnowledgeUseCase } from '../../application/author-knowledge.usecase.js';
import { BrowseKnowledgeUseCase } from '../../application/browse-knowledge.usecase.js';
import { ChangeKnowledgeStatusUseCase } from '../../application/change-knowledge-status.usecase.js';
import { KnowledgeSourcesUseCase } from '../../application/knowledge-sources.usecase.js';

const searchSchema = z.object({
  q: z.string().min(2).max(200),
  category: z.string().max(60).optional(),
  language: z.enum(['en', 'fr']).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const TYPES = ['RULE', 'GUIDE', 'LOCATION', 'PROCESS', 'FAQ', 'DOCUMENT'] as const;
const STATUSES = ['draft', 'review', 'published', 'archived'] as const;

const createSchema = z.object({
  title: z.string().min(3).max(200),
  type: z.enum(TYPES),
  category: z.string().min(2).max(60),
  content: z.string().min(1).max(50_000),
  language: z.enum(['en', 'fr']).optional(),
  slug: z.string().max(80).regex(/^[a-z0-9-]+$/, 'lowercase, digits and hyphens only').optional(),
  sourceId: z.string().uuid().optional(),
  confidenceScore: z.coerce.number().int().min(0).max(100).optional(),
});

const updateSchema = createSchema.partial().omit({ language: true });

const statusSchema = z.object({ status: z.enum(STATUSES) });

const verifySchema = z.object({
  confidenceScore: z.coerce.number().int().min(0).max(100).optional(),
});

const browseSchema = z.object({
  status: z.enum(STATUSES).optional(),
  category: z.string().max(60).optional(),
  language: z.enum(['en', 'fr']).optional(),
  search: z.string().max(120).optional(),
  staleOnly: z.enum(['true', 'false']).optional().transform((value) => value === 'true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const sourceSchema = z.object({
  name: z.string().min(2).max(160),
  sourceType: z.enum(['government', 'partner', 'editorial', 'community']),
  authorityLevel: z.enum(['official', 'partner', 'editorial', 'community']),
  url: z.string().url().max(500).optional(),
});

/**
 * `GET /knowledge/search` from the API Contract Blueprint §8.1, plus the
 * authoring surface behind it.
 *
 * Two audiences on one controller, separated by decorator rather than by file:
 * search is `@Public()` because the knowledge explorer is an acquisition
 * surface, and everything else is `@Roles('knowledge_manager', 'admin')`
 * because it decides what the platform asserts to be true.
 */
@ApiTags('knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly contracts: ContractRegistry,
    private readonly author: AuthorKnowledgeUseCase,
    private readonly browse: BrowseKnowledgeUseCase,
    private readonly changeStatus: ChangeKnowledgeStatusUseCase,
    private readonly sources: KnowledgeSourcesUseCase,
  ) {}

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

  /* ── Authoring ────────────────────────────────────────────────────────
   *
   * `knowledge_manager` is the role the platform has always defined and never
   * given anything to do. This is that surface: the people who decide what the
   * concierge is allowed to state as fact.
   */

  @Roles('knowledge_manager', 'admin')
  @Get()
  @ApiOperation({ summary: 'Browse every item, drafts included (cursor paginated)' })
  async listItems(@Query(zodBody(browseSchema)) query: z.infer<typeof browseSchema>) {
    const page = await this.browse.list({
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.language ? { locale: query.language } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      staleOnly: query.staleOnly,
      limit: query.limit,
    });

    return {
      items: page.items.map((item) => ({
        ...item,
        verifiedAt: item.verifiedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Roles('knowledge_manager', 'admin')
  @Get('sources')
  @ApiOperation({ summary: 'Sources available to cite' })
  async listSources() {
    const sources = await this.sources.list();
    return sources.map((source) => ({
      ...source,
      verifiedAt: source.verifiedAt?.toISOString() ?? null,
    }));
  }

  @Roles('knowledge_manager', 'admin')
  @Post('sources')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a source' })
  async createSource(@Body(zodBody(sourceSchema)) body: z.infer<typeof sourceSchema>) {
    return this.sources.create(body);
  }

  /*
   * Declared AFTER `sources`, and that ordering is load-bearing: Nest matches
   * routes in declaration order, so a `:id` parameter declared first would
   * swallow `/knowledge/sources` and try to parse "sources" as a UUID.
   */
  @Roles('knowledge_manager', 'admin')
  @Get(':id')
  @ApiOperation({ summary: 'One item, with the states it may move to' })
  async getItem(@Param('id', ParseUUIDPipe) id: string) {
    const item = await this.browse.get(id);
    return {
      ...item,
      verifiedAt: item.verifiedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  @Roles('knowledge_manager', 'admin')
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a draft' })
  async createItem(@Body(zodBody(createSchema)) body: z.infer<typeof createSchema>) {
    const { language, ...rest } = body;
    return this.author.create({ ...rest, locale: language ?? 'en' });
  }

  @Roles('knowledge_manager', 'admin')
  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Edit a draft (published items are frozen)' })
  async updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    await this.author.update(id, body);
  }

  @Roles('knowledge_manager', 'admin')
  @Patch(':id/status')
  @ApiOperation({ summary: 'Move an item through the editorial lifecycle' })
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.changeStatus.execute(id, body.status);
  }

  @Roles('knowledge_manager', 'admin')
  @Post(':id/verify')
  @ApiOperation({ summary: 'Record that this item was checked and still holds' })
  async verifyItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(verifySchema)) body: z.infer<typeof verifySchema>,
  ) {
    const { verifiedAt } = await this.author.verify(id, body.confidenceScore);
    return { id, verified_at: verifiedAt.toISOString() };
  }
}
