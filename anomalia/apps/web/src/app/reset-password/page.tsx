import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ResetPasswordForm } from '@/components/auth/recovery-forms';

export const metadata = {
  title: 'Choose a new password',
  // The URL carries a single-use credential. Keeping it out of search indexes
  // is the least that can be done about a secret that lives in a link.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <Container className="py-[clamp(4rem,3rem+4vw,8rem)]">
      <div className="mx-auto max-w-[26rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-6 text-title text-balance">Choose a new password</h1>

        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          /*
           * No token in the URL. Almost always a mail client that truncated
           * the link, so it names the cause and offers the fix rather than
           * rendering a form that could only fail.
           */
          <div className="mt-10">
            <p className="text-body text-pretty">
              This link is missing its token — some mail clients shorten long links.
            </p>
            <p className="mt-6 text-caption text-muted">
              <Link href="/forgot-password" className="text-ink underline underline-offset-4">
                Request a new link
              </Link>
            </p>
          </div>
        )}
      </div>
    </Container>
  );
}
