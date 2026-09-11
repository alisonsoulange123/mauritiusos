import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { getSiteChrome } from '@/shared/capabilities/site-chrome';

/**
 * Inter, self-hosted by next/font.
 *
 * A neutral grotesque in the Helvetica lineage — the right register for Swiss
 * editorial work — with the tight tracking and optical sizing the display
 * scale depends on. Self-hosting means no third-party request, no layout shift
 * from a late webfont, and no CDN in the critical path.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
  // The design uses 400 and 500 only; shipping more weights is dead bytes.
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: {
    default: 'ANOMALIA',
    template: '%s · ANOMALIA',
  },
  description: 'The operating system for relocating, investing and building abroad.',
  applicationName: 'ANOMALIA',
  openGraph: {
    title: 'ANOMALIA',
    description: 'The operating system for relocating, investing and building abroad.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  // Lets the browser paint its own chrome to match the page in both schemes.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfbfa' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
};

/**
 * The root shell.
 *
 * Holds no list of routes or nav items: the chrome is resolved from the
 * feature registry against the API's live capabilities, so adding a feature
 * adds its navigation and disabling a backend module removes it — with no
 * change to this file.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const chrome = await getSiteChrome();

  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          {/* No hardcoded CTA: the header button is whichever entry point this
              deployment actually serves, or nothing at all. */}
          <SiteHeader links={chrome.links} cta={chrome.actions[0]} viewer={chrome.viewer} />
          <main className="flex-1">{children}</main>
          <SiteFooter links={chrome.links} degraded={chrome.degraded} />
        </Providers>
      </body>
    </html>
  );
}
