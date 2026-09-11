import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { CurrentActor, Roles, type AuthenticatedActor } from '../../../../core/auth/auth.decorators.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { ChatUseCase } from '../../application/chat.usecase.js';

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().uuid().optional(),
});

/** `POST /ai/chat` from the API Contract Blueprint §7.1. */
@ApiTags('ai-concierge')
@Controller('ai')
export class AiConciergeController {
  constructor(private readonly chat: ChatUseCase) {}

  @Post('chat')
  @Roles('client', 'advisor', 'admin')
  // LLM calls cost real money per request, so this bucket is much tighter
  // than the platform default.
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Ask the AI concierge' })
  async sendMessage(
    @Body(zodBody(chatSchema)) body: z.infer<typeof chatSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    return this.chat.execute({
      // From the token, never the body: otherwise one user could read
      // another's conversation memory.
      userId: actor.userId,
      message: body.message,
      ...(body.session_id ? { sessionId: body.session_id } : {}),
    });
  }
}
