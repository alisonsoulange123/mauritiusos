import { redirect } from 'next/navigation';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { AuthForm } from '@/components/auth/auth-form';
import { signIn } from '@/shared/auth/actions';
import { getSession } from '@/shared/auth/session';

export const metadata = { title: 'Sign in' };

/** Reads a cookie, so it can never be pre-rendered. */
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; created?: string; reset?: string }>;
}) {
  const { next, created, reset } = await searchParams;

  // Already signed in: send them on rather than showing a form that would
  // replace a working session with an identical one.
  if (await getSession()) redirect(next ?? '/portal');

  return (
    <Container className="py-[clamp(4rem,3rem+4vw,8rem)]">
      <div className="mx-auto max-w-[26rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-6 text-title text-balance">Sign in</h1>

        {created ? (
          <p className="mt-4 text-body text-muted text-pretty">
            Your account was created. Sign in to continue.
          </p>
        ) : null}

        {/*
          Arriving from a completed reset. Saying the other devices were signed
          out matters: it is the visible evidence that the reset did something
          to an attacker's session, and it explains a sign-out the user did not
          perform on their other machine.
        */}
        {reset ? (
          <p className="mt-4 text-body text-muted text-pretty">
            Your password has been changed and every other device was signed out. Sign in with
            your new password.
          </p>
        ) : null}

        <AuthForm
          action={signIn}
          submitLabel="Sign in"
          {...(next ? { next } : {})}
          aside={{ label: 'Forgot your password?', href: '/forgot-password' }}
          footer={{ prompt: 'No account yet?', label: 'Create one', href: '/register' }}
        />
      </div>
    </Container>
  );
}
