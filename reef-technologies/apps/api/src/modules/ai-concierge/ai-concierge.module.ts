import { Module } from '@nestjs/common';
import { AiConciergeController } from './interface/http/ai-concierge.controller.js';
import { ChatUseCase } from './application/chat.usecase.js';
import { AiWorkerClient } from './application/ai-worker.client.js';
import { AiConciergeSubscribers } from './application/ai-concierge.subscribers.js';

@Module({
  controllers: [AiConciergeController],
  providers: [ChatUseCase, AiWorkerClient, AiConciergeSubscribers],
})
export class AiConciergeModule {}
