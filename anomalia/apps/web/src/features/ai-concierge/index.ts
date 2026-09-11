import { defineFeature } from '../feature.definition';

/**
 * AI CONCIERGE — the chat surface.
 *
 * `requiresModules` lists three, not one: the concierge is useless without
 * knowledge retrieval and the eligibility engine behind it, and a chat that
 * cannot cite a verified source is exactly what the AI guardrails forbid. If
 * any of the three is disabled on the API, this feature does not render at
 * all — better an absent feature than a hallucinating one.
 */
export default defineFeature({
  key: 'ai-concierge',
  title: 'AI Concierge',
  description: 'Ask anything about relocating; answers cite verified sources.',
  requiresModules: ['ai-concierge', 'knowledge', 'immigration'],
  requiresRoles: ['client', 'advisor', 'admin'],
  marketing: {
    headline: 'Ask, and see the sources',
    body: 'The concierge retrieves verified knowledge before it answers, then cites what it used. When confidence is low it says so and offers an advisor instead of guessing.',
  },
  mount: () => import('./ui/concierge-screen'),
  nav: { order: 20, icon: 'message-circle' },
});
