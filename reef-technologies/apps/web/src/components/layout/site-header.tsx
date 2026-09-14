'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Wordmark } from '@/components/ui/wordmark';
import { Container } from '@/components/ui/container';
import { cn } from '@/shared/lib/cn';
import { signOut } from '@/shared/auth/actions';

export interface HeaderLink {
  key: string;
  title: string;
  href: string;
}

export interface SiteHeaderProps {
  /**
   * Derived from the feature registry by the server layout. The header holds
   * no list of its own — enabling a backend module adds a link here with no
   * change to this file.
   */
  links: HeaderLink[];
  cta?: { label: string; href: string };
  /** Resolved on the server. `null` means anonymous, never "unknown yet". */
  viewer?: { email: string; backOffice: boolean } | null;
}

/**
 * The site navigation bar.
 *
 * Transparent at the top of the page and gaining its rule only once scrolled,
 * so the hero opens on uninterrupted space — the announcement-page convention.
 * The scroll listener is passive and reads a single boolean, so it does not
 * fight the compositor.
 */
export function SiteHeader({ links, cta, viewer }: SiteHeaderProps) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Navigating closes the menu. Without this it stays open across a client-side
  // transition, covering the page the visitor just asked for.
  useEffect(() => setMenuOpen(false), [pathname]);

  const hasLinks = links.length > 0;

  return (
    <div
      className={cn(
        'sticky top-0 z-50 bg-canvas/80 backdrop-blur-md transition-colors duration-300 ease-editorial',
        scrolled || menuOpen ? 'border-b border-hairline/[0.12]' : 'border-b border-transparent',
      )}
    >
      <Container as="nav" className="flex h-16 items-center justify-between gap-6">
        <Link href="/" className="shrink-0 rounded-sm" aria-label="Reef Technologies — home">
          <Wordmark size="md" />
        </Link>

        <div className="flex items-center gap-1">
          <ul className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-caption transition-colors duration-200 ease-editorial',
                    pathname === link.href ? 'text-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>

          {/*
            Always visible, at every width. The CTA below can be hidden on a
            phone because the hero repeats it; the way back into an account
            has no second copy anywhere on the page.
          */}
          <AccountArea viewer={viewer} />

          {cta ? (
            <Link
              href={cta.href}
              /*
               * Hidden on the narrowest screens and never wrapping. A CTA long
               * enough to break onto two lines collapses the whole header row;
               * below `sm` the hero's own button is immediately below anyway,
               * and navigation lives in the menu.
               */
              className="ml-2 hidden h-9 items-center whitespace-nowrap rounded-full bg-inverse px-4 text-caption font-medium text-inverse-ink transition-colors duration-200 ease-editorial hover:bg-inverse/90 sm:inline-flex"
            >
              {cta.label}
            </Link>
          ) : null}

          {/*
            Below `md` the link list is hidden, so without this the features
            would be unreachable from the header on a phone — the CTA alone is
            not navigation. Rendered only when there is something to show.
          */}
          {hasLinks ? (
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="site-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink transition-colors duration-200 ease-editorial hover:bg-ink/[0.05] md:hidden"
            >
              {/* Two rules that become an X — the whole icon set this design needs. */}
              <span aria-hidden="true" className="relative block h-[9px] w-4">
                <span
                  className={cn(
                    'absolute left-0 block h-px w-full bg-ink transition-transform duration-300 ease-editorial',
                    menuOpen ? 'top-1/2 rotate-45' : 'top-0',
                  )}
                />
                <span
                  className={cn(
                    'absolute left-0 block h-px w-full bg-ink transition-transform duration-300 ease-editorial',
                    menuOpen ? 'top-1/2 -rotate-45' : 'top-full',
                  )}
                />
              </span>
            </button>
          ) : null}
        </div>
      </Container>

      {menuOpen && hasLinks ? (
        <Container id="site-menu" className="pb-5 md:hidden">
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.key}>
                <Link
                  href={link.href}
                  aria-current={pathname === link.href ? 'page' : undefined}
                  className={cn(
                    'block border-t border-hairline/[0.12] py-3 text-body transition-colors duration-200 ease-editorial',
                    pathname === link.href ? 'text-ink' : 'text-muted hover:text-ink',
                  )}
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      ) : null}
    </div>
  );
}

/**
 * The account corner of the header: sign in, or who you are and the way out.
 *
 * Extracted when the Back Office link pushed `SiteHeader` past the project's
 * complexity ceiling. The split is the right one anyway — the header's job is
 * layout and scroll state; who is signed in is a separate question.
 */
function AccountArea({ viewer }: { viewer?: { email: string; backOffice: boolean } | null }) {
  if (!viewer) {
    return (
      <Link
        href="/login"
        className="rounded-full px-3 py-1.5 text-caption text-muted transition-colors duration-200 ease-editorial hover:text-ink"
      >
        Sign in
      </Link>
    );
  }

  return (
    <>
      {/*
        Advisors and admins only, and only ever a link. The gate is the layout
        it points at plus `@Roles` on every endpoint behind it — this just
        avoids offering a door that would slam in everyone else's face.
      */}
      {viewer.backOffice ? (
        <Link
          href="/admin"
          className="hidden rounded-full px-3 py-1.5 text-caption text-muted transition-colors duration-200 ease-editorial hover:text-ink sm:inline-block"
        >
          Back office
        </Link>
      ) : null}

      <form action={signOut} className="flex items-center gap-3">
        <span
          className="hidden max-w-[16ch] truncate text-caption text-muted lg:inline"
          title={viewer.email}
        >
          {viewer.email}
        </span>
        <button
          type="submit"
          className="rounded-full px-3 py-1.5 text-caption text-muted transition-colors duration-200 ease-editorial hover:text-ink"
        >
          Sign out
        </button>
      </form>
    </>
  );
}
