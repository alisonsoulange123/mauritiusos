'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  confirmEmail,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  type RecoveryFormState,
} from '@/shared/auth/actions';
import { FormAlert, FormField, Submit } from './form-parts';

/**
 * The three recovery screens, plus the resend prompt that lives in the portal.
 *
 * All uncontrolled, like the sign-in form and for the same reason: the action
 * reads `FormData` directly, so a password never enters React state and never
 * appears in a re-render or a devtools snapshot.
 */

const EMPTY: RecoveryFormState = {};

export function ForgotPasswordForm() {
  const [state, action] = useActionState<RecoveryFormState, FormData>(
    requestPasswordReset,
    EMPTY,
  );

  /*
   * The confirmation is deliberately vague about whether anything was sent.
   * "We have sent you a link" would confirm the address is registered to
   * anyone who types one in; "if that address has an account" says the only
   * true thing this screen can say.
   */
  if (state.done) {
    return (
      <div className="mt-10">
        <p className="text-body text-pretty">
          If that address has an account, a reset link is on its way. It is valid for one hour
          and can be used once.
        </p>
        <p className="mt-6 text-caption text-muted">
          Nothing arrived?{' '}
          <Link href="/forgot-password" className="text-ink underline underline-offset-4">
            Try again
          </Link>{' '}
          — and check the spam folder first.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-10">
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}

      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />

      <Submit label="Send reset link" pendingLabel="Sending…" />

      <p className="mt-8 text-caption text-muted">
        Remembered it?{' '}
        <Link href="/login" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<RecoveryFormState, FormData>(resetPassword, EMPTY);

  return (
    <form action={action} className="mt-10">
      {/* The token rides in the form rather than being re-read from the URL by
          the action, so a redirect or a refresh cannot lose it mid-submit. */}
      <input type="hidden" name="token" value={token} />

      {state.error ? <FormAlert>{state.error}</FormAlert> : null}

      <div className="space-y-5">
        <FormField
          id="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 12 characters."
          error={state.fieldErrors?.password}
        />
        <FormField
          id="confirm"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          error={state.fieldErrors?.confirm}
        />
      </div>

      <Submit label="Set new password" pendingLabel="Saving…" />

      <p className="mt-8 text-caption text-muted">
        Every device signed in to this account will be signed out.
      </p>
    </form>
  );
}

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action] = useActionState<RecoveryFormState, FormData>(confirmEmail, EMPTY);

  if (state.done) {
    return (
      <div className="mt-10">
        <p className="text-body text-pretty">
          Your email address is confirmed.
        </p>
        <p className="mt-6 text-caption text-muted">
          <Link href="/portal" className="text-ink underline underline-offset-4">
            Go to the portal
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="mt-10">
      <input type="hidden" name="token" value={token} />
      {state.error ? <FormAlert>{state.error}</FormAlert> : null}
      <Submit label="Confirm my email" pendingLabel="Confirming…" className="mt-0" />
    </form>
  );
}

/** The prompt shown in the portal to an account that has not confirmed yet. */
export function ResendVerificationForm() {
  const [state, action] = useActionState<RecoveryFormState, FormData>(
    resendVerification,
    EMPTY,
  );

  if (state.done) {
    return <p className="mt-3 text-caption text-muted">A new link is on its way.</p>;
  }

  return (
    <form action={action}>
      {state.error ? <p className="mt-3 text-caption text-ink">{state.error}</p> : null}
      <Submit label="Send me a new link" pendingLabel="Sending…" className="mt-4 w-auto" />
    </form>
  );
}
