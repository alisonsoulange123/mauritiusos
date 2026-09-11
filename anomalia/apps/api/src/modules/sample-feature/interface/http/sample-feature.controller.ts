import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseUUIDPipe } from '@nestjs/common';
import type { Page } from '@anomalia/contracts';
import { CurrentActor, Roles, type AuthenticatedActor } from '../../../../core/auth/auth.decorators.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { CreateSampleItemUseCase } from '../../application/create-sample-item.usecase.js';
import { ListSampleItemsUseCase } from '../../application/list-sample-items.usecase.js';
import { ArchiveSampleItemUseCase } from '../../application/archive-sample-item.usecase.js';
import type { SampleItem } from '../../domain/sample-item.entity.js';
import {
  createSampleItemSchema,
  listSampleItemsSchema,
  type CreateSampleItemDto,
  type SampleItemResponseDto,
} from './sample-item.dto.js';

/**
 * The module's REST interface — a thin adapter, deliberately.
 *
 * It does four things and nothing else: validate input, resolve the actor,
 * call one use case, serialize the result. No business logic, no queries. That
 * is what lets the same use cases be driven by a GraphQL resolver, a gRPC
 * service or a CLI later without touching a line of business code.
 *
 * Routes are nested under the API prefix from config, so a module never
 * hardcodes a version: `/api/v1/sample-items`.
 */
@ApiTags('sample-feature')
@Controller('sample-items')
export class SampleFeatureController {
  constructor(
    private readonly createItem: CreateSampleItemUseCase,
    private readonly listItems: ListSampleItemsUseCase,
    private readonly archiveItem: ArchiveSampleItemUseCase,
  ) {}

  @Post()
  @HttpCode(201)
  @Roles('client', 'advisor', 'admin')
  @ApiOperation({ summary: 'Create a sample item' })
  async create(
    @Body(zodBody(createSampleItemSchema)) body: CreateSampleItemDto,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<SampleItemResponseDto> {
    const item = await this.createItem.execute({
      title: body.title,
      ...(body.notes ? { notes: body.notes } : {}),
      // Owner comes from the verified token, never from the body — otherwise
      // any caller could create items on another user's behalf.
      ownerId: actor.userId,
    });
    return present(item);
  }

  @Get()
  @Roles('client', 'advisor', 'admin')
  @ApiOperation({ summary: 'List sample items (cursor paginated)' })
  async list(
    @Query(zodBody(listSampleItemsSchema)) query: { cursor?: string; limit: number },
  ): Promise<Page<SampleItemResponseDto>> {
    const page = await this.listItems.execute(query);
    return { items: page.items.map(present), nextCursor: page.nextCursor };
  }

  @Post(':id/archive')
  @HttpCode(204)
  @Roles('client', 'advisor', 'admin')
  @ApiOperation({ summary: 'Archive an item you own' })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentActor() actor: AuthenticatedActor,
  ): Promise<void> {
    await this.archiveItem.execute(id, actor.userId, actor.roles.includes('admin'));
  }
}

/** Entity -> wire shape. Keeps `tenantId` and internals off the wire. */
const present = (item: SampleItem): SampleItemResponseDto => {
  const snapshot = item.snapshot();
  return {
    id: snapshot.id,
    title: snapshot.title,
    notes: snapshot.notes,
    status: snapshot.status,
    ownerId: snapshot.ownerId,
    createdAt: snapshot.createdAt.toISOString(),
  };
};
