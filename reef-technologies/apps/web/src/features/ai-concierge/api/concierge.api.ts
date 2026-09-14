import { z } from 'zod';
import { apiRequest } from '@/shared/api/client';

const chatResponseSchema = z.object({
  session_id: z.string().uuid(),
  answer: z.string(),
  sources: z.array(z.string()),
  confidence: z.number(),
  actions: z.array(
    z.object({ type: z.string(), label: z.string(), payload: z.record(z.unknown()).optional() }),
  ),
  requires_human_review: z.boolean(),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;

/**
 * No token parameter: this runs in the browser, where the session is an
 * httpOnly cookie the proxy turns into a bearer. There is nothing for a
 * feature to hold, and therefore nothing for it to leak.
 */
export const sendMessage = async (message: string, sessionId: string | null) =>
  chatResponseSchema.parse(
    await apiRequest('/ai/chat', {
      method: 'POST',
      body: { message, ...(sessionId ? { session_id: sessionId } : {}) },
    }),
  );
