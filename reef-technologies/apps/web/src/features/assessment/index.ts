import { defineFeature } from '../feature.definition';

/**
 * ASSESSMENT — the acquisition funnel (UX blueprint §5).
 *
 * Public, because it runs before registration: the visitor answers six
 * questions and gets a diagnosis, and only then is asked for an email. Trust
 * before transaction.
 *
 * This file is metadata ONLY — no component imports. The registry imports it
 * eagerly, so anything pulled in here would land in the shared bundle. The
 * screen arrives through `mount()`.
 */
export default defineFeature({
  key: 'assessment',
  title: 'Eligibility Assessment',
  description: 'Six questions, then a personalised relocation diagnosis.',
  requiresModules: ['assessment', 'immigration'],
  public: true,
  marketing: {
    headline: 'Find out where you stand',
    cta: 'Check your eligibility',
    body: 'Six questions, no account. A rules engine evaluates your profile against current permit criteria and tells you which pathway fits — and what is missing if none does.',
  },
  mount: () => import('./ui/assessment-screen'),
  nav: { order: 10, icon: 'clipboard-check' },
});
