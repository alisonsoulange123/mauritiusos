import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ConfirmEmailForm } from '@/components/auth/recovery-forms';

export const metadata = {
  title: 'Confirm your email',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The landing page for a confirmation link.
 *
 * It asks for a click instead of confirming on load. Mail clients, link
 * checkers and corporate security scanners follow URLs before a human does, so
 * a page that spent the token during a GET would routinely be already used by
 * the time its owner opened it — and the user would be told their own link was
 * invalid. A form post cannot be triggered by a prefetch.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <Container className="py-[clamp(4rem,3rem+4vw,8rem)]">
      <div className="mx-auto max-w-[26rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-6 text-title text-balance">Confirm your email</h1>

        {token ? (
          <>
            <p className="mt-4 text-body text-muted text-pretty">
              One click and the address on your account is confirmed.
            </p>
            <ConfirmEmailForm token={token} />
          </>
        ) : (
          <div className="mt-10">
            <p className="text-body text-pretty">
              This link is missing its token — some mail clients shorten long links.
            </p>
            <p className="mt-6 text-caption text-muted">
              Sign in and request a new one from{' '}
              <Link href="/portal" className="text-ink underline underline-offset-4">
                the portal
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </Container>
  );
}
