'use client';

import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/cn';

/**
 * The pieces every credential form is built from.
 *
 * Extracted when account recovery added three more forms to the two that
 * existed. Duplicating them is how autocomplete hints, error placement and the
 * disabled state drift apart — and those are exactly the details that decide
 * whether a password manager works and whether a screen reader hears the
 * failure.
 */

const CONTROL = cn(
  'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5',
  'text-body text-ink transition-colors duration-200 ease-editorial',
  'placeholder:text-muted hover:border-hairline/30 focus:border-ink/50',
);

export interface FormFieldProps {
  id: string;
  label: string;
  type: string;
  autoComplete: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
  error?: string;
}

export function FormField({
  id,
  label,
  type,
  autoComplete,
  required,
  defaultValue,
  hint,
  error,
}: FormFieldProps) {
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
        defaultValue={defaultValue}
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
 * Announced rather than merely shown: a failure that only changes colour is
 * invisible to a screen reader.
 */
export function FormAlert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mb-6 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
      {children}
    </p>
  );
}

/**
 * Split out because `useFormStatus` reports on the nearest enclosing form, so
 * it only works from inside one — reading it in the parent would always return
 * idle.
 */
export function Submit({
  label,
  pendingLabel = 'Working…',
  className,
}: {
  label: string;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className={cn('mt-8 w-full', className)} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
