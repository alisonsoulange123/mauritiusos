import { ArrowLink } from '@/components/ui/arrow-link';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';

export interface HeroProps {
  /** Small label above the headline. */
  eyebrow: string;
  headline: string;
  standfirst: string;
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  /** Terse facts under the rule — the announcement-page byline row. */
  meta?: string[];
}

/**
 * The announcement hero.
 *
 * Left-aligned, not centred. Centred type has no consistent left edge, so on a
 * page whose only structure is alignment it reads as drifting; ranging left
 * gives every section below something to line up with.
 *
 * The headline is capped at `max-w-[18ch]` rather than a pixel width so the
 * line break follows the type size at every viewport instead of one chosen
 * breakpoint.
 */
export function Hero({ eyebrow, headline, standfirst, primaryAction, secondaryAction, meta }: HeroProps) {
  return (
    <header className="pt-[clamp(4rem,2rem+7vw,7.5rem)] pb-[clamp(3rem,2rem+2.5vw,4.5rem)]">
      <Container>
        <div className="grid-editorial">
          <div className="col-span-4 md:col-span-6 lg:col-span-10">
            <Eyebrow className="animate-rise-in">{eyebrow}</Eyebrow>

            <h1
              className="mt-6 max-w-[18ch] text-display animate-rise-in"
              // Staggered by 60ms: enough to read as sequence, not as a queue.
              style={{ animationDelay: '60ms' }}
            >
              {headline}
            </h1>

            <p
              className="mt-7 max-w-prose text-lead text-muted text-pretty animate-rise-in"
              style={{ animationDelay: '120ms' }}
            >
              {standfirst}
            </p>

            {(primaryAction ?? secondaryAction) ? (
              <div
                className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4 animate-rise-in"
                style={{ animationDelay: '180ms' }}
              >
                {primaryAction ? (
                  <a
                    href={primaryAction.href}
                    className="inline-flex h-12 items-center rounded-full bg-inverse px-6 text-body font-medium text-inverse-ink transition-colors duration-200 ease-editorial hover:bg-inverse/90"
                  >
                    {primaryAction.label}
                  </a>
                ) : null}
                {secondaryAction ? (
                  <ArrowLink href={secondaryAction.href}>{secondaryAction.label}</ArrowLink>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {meta?.length ? (
          <dl className="rule mt-[clamp(3rem,1.5rem+4vw,5rem)] flex flex-wrap gap-x-10 gap-y-3 pt-5">
            {meta.map((item) => (
              <dd key={item} className="text-caption text-muted">
                {item}
              </dd>
            ))}
          </dl>
        ) : null}
      </Container>
    </header>
  );
}
