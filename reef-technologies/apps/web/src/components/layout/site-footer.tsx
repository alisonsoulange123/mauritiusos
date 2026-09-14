import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Wordmark } from '@/components/ui/wordmark';

export interface FooterLink {
  key: string;
  title: string;
  href: string;
}

export interface SiteFooterProps {
  /** Registry-derived, exactly as in the header. */
  links: FooterLink[];
  /** Shown when the API is unreachable or serving nothing public. */
  degraded?: boolean;
}

/**
 * The footer.
 *
 * Ends the page on the wordmark rather than opening with it, closing the
 * editorial frame the header started. Link columns are registry-derived, so
 * the footer cannot advertise a feature the deployment does not serve — the
 * classic source of dead links in a flag-driven product.
 */
export function SiteFooter({ links, degraded = false }: SiteFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="rule mt-auto py-[clamp(3rem,2rem+3vw,5rem)]">
      <Container>
        <div className="grid-editorial gap-y-12">
          <div className="col-span-4 md:col-span-6 lg:col-span-5">
            <Wordmark size="lg" as="div" />
            <p className="mt-5 max-w-[32ch] text-body text-muted text-pretty">
              The operating system for relocating, investing and building abroad.
            </p>
          </div>

          {links.length > 0 ? (
            <nav className="col-span-4 md:col-span-3 lg:col-span-3 lg:col-start-9">
              <Eyebrow>Platform</Eyebrow>
              <ul className="mt-5 space-y-3">
                {links.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      className="text-body text-muted transition-colors duration-200 ease-editorial hover:text-ink"
                    >
                      {link.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>

        <div className="rule mt-14 flex flex-wrap items-center justify-between gap-4 pt-6">
          <p className="text-caption text-muted">© {year} Reef Technologies</p>
          <p className="text-caption text-muted">
            {degraded
              ? 'Platform services unavailable'
              : 'Verified sources · Multi-tenant · AI-native'}
          </p>
        </div>
      </Container>
    </footer>
  );
}
