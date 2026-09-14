import { redirect } from 'next/navigation';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ForgotPasswordForm } from '@/components/auth/recovery-forms';
import { getSession } from '@/shared/auth/session';

export const metadata = { title: 'Reset your password' };

/** Reads a cookie, so it can never be pre-rendered. */
export const dynamic = 'force-dynamic';

export default async function ForgotPasswordPage() {
  // Someone already signed in does not need a recovery link; sending them to
  // the portal is more useful than a form that would email them one.
  if (await getSession()) redirect('/portal');

  return (
    <Container className="py-[clamp(4rem,3rem+4vw,8rem)]">
      <div className="mx-auto max-w-[26rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-6 text-title text-balance">Reset your password</h1>
        <p className="mt-4 text-body text-muted text-pretty">
          Enter the address on your account and we will send you a link.
        </p>

        <ForgotPasswordForm />
      </div>
    </Container>
  );
}
