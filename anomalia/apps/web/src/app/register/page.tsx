import { redirect } from 'next/navigation';
import { Container } from '@/components/ui/container';
import { Eyebrow } from '@/components/ui/eyebrow';
import { AuthForm } from '@/components/auth/auth-form';
import { signUp } from '@/shared/auth/actions';
import { getSession } from '@/shared/auth/session';

export const metadata = { title: 'Create an account' };

export const dynamic = 'force-dynamic';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  if (await getSession()) redirect(next ?? '/portal');

  return (
    <Container className="py-[clamp(4rem,3rem+4vw,8rem)]">
      <div className="mx-auto max-w-[26rem]">
        <Eyebrow>Account</Eyebrow>
        <h1 className="mt-6 text-title text-balance">Create an account</h1>
        <p className="mt-4 text-body text-muted text-pretty">
          Your assessment, saved plan and concierge history stay with the account.
        </p>

        <AuthForm
          action={signUp}
          submitLabel="Create account"
          includeName
          // States the rule up front. Finding out after a failed submit is the
          // most common way a registration form loses someone.
          passwordHint="At least 12 characters."
          {...(next ? { next } : {})}
          footer={{ prompt: 'Already registered?', label: 'Sign in', href: '/login' }}
        />
      </div>
    </Container>
  );
}
