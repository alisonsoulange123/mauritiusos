import { Module } from '@nestjs/common';
import { KnowledgeController } from './interface/http/knowledge.controller.js';
import { KnowledgeContractImpl } from './application/knowledge.contract-impl.js';
import { AuthorKnowledgeUseCase } from './application/author-knowledge.usecase.js';
import { BrowseKnowledgeUseCase } from './application/browse-knowledge.usecase.js';
import { ChangeKnowledgeStatusUseCase } from './application/change-knowledge-status.usecase.js';
import { KnowledgeSourcesUseCase } from './application/knowledge-sources.usecase.js';

@Module({
  controllers: [KnowledgeController],
  providers: [
    KnowledgeContractImpl,
    AuthorKnowledgeUseCase,
    BrowseKnowledgeUseCase,
    ChangeKnowledgeStatusUseCase,
    KnowledgeSourcesUseCase,
  ],
})
export class KnowledgeModule {}
