'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';
import type { AuthFormState } from '@/shared/auth/actions';

export interface AuthFormProps {
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  submitLabel: string;
  /** Collected only on registration. */
  includeName?: boolean;
  passwordHint?: string;
  /** Carried through the form so a redirect survives the round trip. */
  next?: string;
  footer: { prompt: string; label: string; href: string };
}

const CONTROL = cn(
  'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5',
  'text-body text-ink transition-colors duration-200 ease-editorial',
  'placeholder:text-muted hover:border-hairline/30 focus:border-ink/50',
);

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
  footer,
}: AuthFormProps) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});

  return (
    <form action={formAction} className="mt-10">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <p
          // Announced rather than merely shown: a failed sign-in that only
          // changes colour is invisible to a screen reader.
          role="alert"
          className="mb-6 border-l-2 border-ink py-1 pl-3 text-caption text-ink"
        >
          {state.error}
        </p>
      ) : null}

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

interface FormFieldProps {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  required?: boolean;
  hint?: string;
  error?: string;
}

function FormField({ id, label, type, autoComplete, required, hint, error }: FormFieldProps) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div>
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={CONTROL}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-caption text-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-caption text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Split out because `useFormStatus` reports on the nearest enclosing form, so
 * it only works from inside one — reading it in `AuthForm` would always return
 * idle.
 */
function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-8 w-full" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}
