'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import type { AuthFormState } from '@/shared/auth/actions';
import { FormAlert, FormField, Submit } from './form-parts';

export interface AuthFormProps {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Collected only on registration. */
  includeName?: boolean;
  passwordHint?: string;
  /** Carried through the form so a redirect survives the round trip. */
  next?: string;
  /** Sign-in only: the way out for someone who cannot remember the password. */
  aside?: { label: string; href: string };
  footer: { prompt: string; label: string; href: string };
}

/**
 * Sign-in and registration share one form because they differ by one field and
 * one label. Two near-identical files would drift in exactly the places that
 * matter — autocomplete hints, error placement, the disabled state.
 *
 * Uncontrolled on purpose: the action receives the `FormData` directly, so the
 * password is never held in React state, never in a re-render, and never in a
 * devtools snapshot.
 */
export function AuthForm({
  action,
  submitLabel,
  includeName,
  passwordHint,
  next,
  aside,
  footer,
}: AuthFormProps) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="mt-10">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? <FormAlert>{state.error}</FormAlert> : null}

      <div className="space-y-5">
        {includeName ? (
          <FormField
            id="firstName"
            label="First name"
            type="text"
            autoComplete="given-name"
            error={state.fieldErrors?.firstName}
          />
        ) : null}

        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={state.fieldErrors?.email}
        />

        <FormField
          id="password"
          label="Password"
          type="password"
          // `new-password` on registration tells a password manager to offer a
          // generated one; `current-password` on sign-in tells it to fill.
          autoComplete={includeName ? 'new-password' : 'current-password'}
          required
          hint={passwordHint}
          error={state.fieldErrors?.password}
        />
      </div>

      {/*
        Under the password field and above the button, which is where someone
        who has already failed to remember it is looking.
      */}
      {aside ? (
        <p className="mt-3 text-caption">
          <Link href={aside.href} className="text-muted underline underline-offset-4 hover:text-ink">
            {aside.label}
          </Link>
        </p>
      ) : null}

      <Submit label={submitLabel} />

      <p className="mt-8 text-caption text-muted">
        {footer.prompt}{' '}
        <Link href={footer.href} className="text-ink underline underline-offset-4">
          {footer.label}
        </Link>
      </p>
    </form>
  );
}
