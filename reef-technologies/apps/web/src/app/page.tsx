import { Hero } from '@/components/landing/hero';
import { FeatureGrid } from '@/components/landing/feature-grid';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ArrowLink } from '@/components/ui/arrow-link';
import { getSiteChrome } from '@/shared/capabilities/site-chrome';

/**
 * The landing page.
 *
 * Composition only — it resolves which features this deployment serves and
 * hands presentational sections their content. Every section below is
 * registry-driven: turn a backend module off and its grid cell, its nav link
 * and its footer entry all disappear together, with no conditional written
 * anywhere on this page.
 */
export default async function LandingPage() {
  const chrome = await getSiteChrome();

  return (
    <>
      <Hero
        eyebrow="Platform · Mauritius"
        headline="Know whether you can come, what it costs, and what to do first."
        standfirst="Most relocation advice is either a forum post or a €400 consultation. Reef Technologies sits between them: verified rules, a decision engine that shows its reasoning, and an AI concierge that cites its sources."
        primaryAction={chrome.actions[0]}
        secondaryAction={chrome.actions[1]}
        meta={[
          'Sources traced to government publications',
          'Rules evaluated, never generated',
          'Built to extend beyond Mauritius',
        ]}
      />

      <FeatureGrid eyebrow="Capabilities" cards={chrome.cards} />

      {/*
        The closing statement. An inverted block is the one tonal shift on the
        page, which is what lets it carry the final call to action without a
        second accent colour being introduced anywhere else.
      */}
      <section className="rule py-section">
        <Container>
          <div className="grid-editorial">
            <div className="col-span-4 md:col-span-6 lg:col-span-7">
              <Eyebrow>Approach</Eyebrow>
              <h2 className="mt-6 max-w-[20ch] text-title text-balance">
                The model phrases the answer. It never decides it.
              </h2>
              <p className="mt-6 max-w-prose text-lead text-muted text-pretty">
                Eligibility comes from a rules engine that returns the conditions it matched. Facts
                come from a knowledge base with a source and a last-checked date. The language model
                is given both before it writes a word — so when confidence is low, the platform says
                so and offers a human instead.
              </p>
              {/*
                Same derived entry point as the hero — the first reachable
                feature in nav order, which is the funnel when it is enabled.
              */}
              {chrome.actions[0] ? (
                <div className="mt-8">
                  <ArrowLink href={chrome.actions[0].href}>{chrome.actions[0].label}</ArrowLink>
                </div>
              ) : null}
            </div>
          </div>
        </Container>
      </section>

      {chrome.degraded ? (
        <Container className="pb-section">
          <p className="rule pt-6 text-caption text-muted">
            Platform services are unreachable, so only static content is shown.
          </p>
        </Container>
      ) : null}
    </>
  );
}
