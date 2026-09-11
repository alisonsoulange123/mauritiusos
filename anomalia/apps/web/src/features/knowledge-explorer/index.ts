import { defineFeature } from '../feature.definition';

/**
 * KNOWLEDGE EXPLORER — public, on purpose.
 *
 * UX blueprint §20, principle 3: help before selling. The knowledge base is
 * the acquisition surface and the trust-builder, so it needs no account.
 */
export default defineFeature({
  key: 'knowledge-explorer',
  title: 'Knowledge',
  description: 'Verified guides and rules, each with its source and last-checked date.',
  requiresModules: ['knowledge'],
  public: true,
  marketing: {
    headline: 'Rules, with provenance',
    cta: 'Read the knowledge base',
    body: 'Every guide and regulation carries its source, its authority level and the date it was last checked. Anything unverified for too long stops being served as current.',
  },
  mount: () => import('./ui/knowledge-screen'),
  nav: { order: 30, icon: 'book-open' },
});
