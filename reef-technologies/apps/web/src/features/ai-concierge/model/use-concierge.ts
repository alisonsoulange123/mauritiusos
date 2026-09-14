'use client';

import { useCallback, useState } from 'react';
import { ApiRequestError } from '@/shared/api/client';
import { sendMessage, type ChatResponse } from '../api/concierge.api';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  confidence?: number;
  needsReview?: boolean;
}

export function useConcierge() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || pending) return;

      const userTurn: ChatTurn = { id: crypto.randomUUID(), role: 'user', content: trimmed };
      // Optimistic append: the user sees their message immediately, which
      // matters when the model takes several seconds to answer.
      setTurns((previous) => [...previous, userTurn]);
      setPending(true);
      setError(null);

      try {
        const response: ChatResponse = await sendMessage(trimmed, sessionId);
        setSessionId(response.session_id);
        setTurns((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.answer,
            sources: response.sources,
            confidence: response.confidence,
            needsReview: response.requires_human_review,
          },
        ]);
      } catch (caught) {
        // Roll the optimistic turn back so the input can be retried cleanly.
        setTurns((previous) => previous.filter((turn) => turn.id !== userTurn.id));
        setError(
          caught instanceof ApiRequestError
            ? `${caught.message} (ref ${caught.traceId})`
            : 'The concierge is unavailable right now.',
        );
      } finally {
        setPending(false);
      }
    },
    [pending, sessionId],
  );

  return { turns, pending, error, ask };
}
