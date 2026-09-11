import { Module } from '@nestjs/common';
import { KnowledgeController } from './interface/http/knowledge.controller.js';
import { KnowledgeContractImpl } from './application/knowledge.contract-impl.js';

@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeContractImpl],
})
export class KnowledgeModule {}
