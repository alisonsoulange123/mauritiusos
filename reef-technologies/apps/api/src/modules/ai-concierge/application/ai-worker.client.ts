import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '@reef-technologies/contracts';
import { ConfigService } from '../../../core/config/config.service.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';

export interface ConciergeRequest {
  message: string;
  userId: string;
  sessionId: string;
  locale: string;
  /** Pre-authorized context. The worker never queries our database itself. */
  context: {
    profile: Record<string, unknown> | null;
    eligibility: Record<string, unknown> | null;
    knowledge: Array<{ id: string; title: string; excerpt: string; confidence: number }>;
    memory: Array<{ key: string; value: string }>;
  };
}

export interface ConciergeResponse {
  answer: string;
  citations: string[];
  confidence: number;
  suggestedActions: Array<{ type: string; label: string; payload?: Record<string, unknown> }>;
  usage?: { promptTokens: number; completionTokens: number };
}

/**
 * The Node → Python boundary for SYNCHRONOUS work (a chat turn, which a user
 * is waiting on). Asynchronous work — embedding a new knowledge article,
 * generating a relocation plan — goes over the event bus instead.
 *
 * Two properties that matter in production:
 *
 *  • The worker is sent ONLY pre-authorized context (Security §15). It has no
 *    database credentials, so a prompt injection cannot make it read another
 *    user's documents — there is nothing to read.
 *  • Timeouts are enforced with AbortController. An LLM call that hangs must
 *    not hold a Node request handler open until the socket dies.
 */
@Injectable()
export class AiWorkerClient {
  private readonly logger = new Logger(AiWorkerClient.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContext,
  ) {}

  async chat(request: ConciergeRequest): Promise<ConciergeResponse> {
    const { AI_CONCIERGE_REQUEST_TIMEOUT_MS } = this.config.module<{ AI_CONCIERGE_REQUEST_TIMEOUT_MS: number }>();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_CONCIERGE_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.config.core.AI_WORKER_BASE_URL}/v1/concierge/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The worker enforces tenant scoping on its own side too.
          'x-reef-technologies-tenant-id': this.tenantContext.requireTenantId(),
          'x-trace-id': this.tenantContext.traceId(),
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new DomainError(
          'AI_WORKER_ERROR',
          'The AI service could not answer right now.',
          502,
          detail ? [{ path: 'worker', message: detail.slice(0, 300) }] : undefined,
        );
      }

      return (await response.json()) as ConciergeResponse;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DomainError('AI_WORKER_TIMEOUT', 'The AI service took too long to respond.', 504);
      }
      this.logger.error('AI worker call failed', error instanceof Error ? error.stack : String(error));
      throw new DomainError('AI_WORKER_UNAVAILABLE', 'The AI service is unavailable.', 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}
