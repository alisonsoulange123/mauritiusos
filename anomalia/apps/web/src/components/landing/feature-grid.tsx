import { ArrowLink } from '@/components/ui/arrow-link';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';

export interface FeatureCard {
  key: string;
  href: string;
  title: string;
  headline: string;
  body: string;
  /** Live in this deployment, but closed to this viewer. Rendered unlinked. */
  locked?: boolean;
  /** Which wall it is, so the card can name it accurately. */
  lockedReason?: 'requires-auth' | 'role-missing';
}

/**
 * A locked card has to say something true, and "sign in" stops being true the
 * moment sessions are real: a signed-in visitor whose role does not cover the
 * feature has already done the thing the card was telling them to do.
 *
 * The two locks are different asks. One is a sign-in — free, immediate, and
 * the visitor already knows how. The other is an upgrade, which is a decision,
 * so it names what unlocks it rather than implying another login would.
 */
const LOCK_COPY: Record<'requires-auth' | 'role-missing', string> = {
  'requires-auth': 'Available once you sign in',
  'role-missing': 'Requires a client account',
};

export interface FeatureGridProps {
  eyebrow: string;
  cards: FeatureCard[];
}

/**
 * The numbered feature grid.
 *
 * Presentational and prop-driven: it receives cards and knows nothing about the
 * feature registry or the API. The page resolves which features this
 * deployment actually serves and passes the survivors in, so a disabled
 * backend module removes its own section from the landing page without this
 * component containing a single conditional.
 *
 * Numbering is the Swiss device that replaces icons — it gives each cell a
 * fixed anchor and makes the set read as a sequence rather than a menu. The
 * numbers are decorative, hence `aria-hidden`.
 */
export function FeatureGrid({ eyebrow, cards }: FeatureGridProps) {
  if (cards.length === 0) return null;

  return (
    <section className="rule py-section" aria-labelledby="capabilities">
      <Container>
        <Eyebrow id="capabilities">{eyebrow}</Eyebrow>

        {/*
          `divide-*` renders the rules BETWEEN cells only, so the grid never
          ends on a stray trailing line. The axis flips with the breakpoint:
          horizontal rules when stacked, vertical when side by side.
        */}
        <div className="mt-10 grid grid-cols-1 divide-y divide-hairline/[0.12] md:grid-cols-3 md:divide-x md:divide-y-0">
          {cards.map((card, index) => (
            <article
              key={card.key}
              className="flex flex-col gap-4 py-8 first:pt-0 md:px-7 md:py-0 md:first:pl-0 md:last:pr-0"
            >
              <span aria-hidden="true" className="font-mono text-caption tabular-nums text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>

              <h3 className="text-heading text-balance">{card.headline}</h3>

              <p className="text-body text-muted text-pretty">{card.body}</p>

              {/*
                A locked card gets no link rather than a link that 404s.
                Advertising the capability is useful; sending someone to a wall
                is not.
              */}
              {card.locked ? (
                <p className="mt-auto pt-2 text-body text-muted">
                  {LOCK_COPY[card.lockedReason ?? 'requires-auth']}
                </p>
              ) : (
                <ArrowLink href={card.href} className="mt-auto pt-2">
                  {card.title}
                </ArrowLink>
              )}
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
