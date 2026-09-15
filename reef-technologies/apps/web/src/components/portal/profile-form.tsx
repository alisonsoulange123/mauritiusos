'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { saveProfile, type ProfileFormState } from '@/shared/auth/profile.actions';

export interface Profile {
  firstName: string | null;
  lastName: string | null;
  nationality: string | null;
  currentCountry: string | null;
  birthDate: string | null;
  occupation: string | null;
  monthlyIncome: number | null;
  currency: string | null;
  familyStatus: string | null;
}

const FIELD =
  'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:border-ink/50';

const EMPTY: ProfileFormState = {};

/** Occupations the eligibility rules recognise; anything else matches nothing. */
const OCCUPATIONS = ['employed', 'self_employed', 'business_owner', 'retired', 'remote_worker'];

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action] = useActionState<ProfileFormState, FormData>(saveProfile, EMPTY);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="mt-8 max-w-xl">
      {state.error ? (
        <p role="alert" className="mb-6 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="mb-6 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.notice}
        </p>
      ) : null}

      <div className="space-y-5">
        <div className="flex flex-wrap gap-5">
          <Field id="firstName" label="First name" error={errors.firstName}>
            <input id="firstName" name="firstName" defaultValue={profile.firstName ?? ''} className={FIELD} />
          </Field>
          <Field id="lastName" label="Last name" error={errors.lastName}>
            <input id="lastName" name="lastName" defaultValue={profile.lastName ?? ''} className={FIELD} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-5">
          <Field id="nationality" label="Nationality" hint="Two-letter country code." error={errors.nationality}>
            <input
              id="nationality"
              name="nationality"
              maxLength={2}
              placeholder="FR"
              defaultValue={profile.nationality ?? ''}
              className={FIELD}
            />
          </Field>
          <Field id="currentCountry" label="Currently living in" error={errors.currentCountry}>
            <input
              id="currentCountry"
              name="currentCountry"
              maxLength={2}
              placeholder="BE"
              defaultValue={profile.currentCountry ?? ''}
              className={FIELD}
            />
          </Field>
        </div>

        {/* A date rather than an age: the permit rules are written in ages, and
            an age stored today is wrong within a year. */}
        <Field
          id="birthDate"
          label="Date of birth"
          hint="Several permits have an age threshold."
          error={errors.birthDate}
        >
          <input id="birthDate" name="birthDate" type="date" defaultValue={profile.birthDate ?? ''} className={FIELD} />
        </Field>

        <Field id="occupation" label="Occupation" error={errors.occupation}>
          <select id="occupation" name="occupation" defaultValue={profile.occupation ?? ''} className={FIELD}>
            <option value="">—</option>
            {OCCUPATIONS.map((option) => (
              <option key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex flex-wrap gap-5">
          <Field
            id="monthlyIncome"
            label="Monthly income"
            hint="Used only to evaluate permit thresholds."
            error={errors.monthlyIncome}
          >
            <input
              id="monthlyIncome"
              name="monthlyIncome"
              type="number"
              min={0}
              defaultValue={profile.monthlyIncome ?? ''}
              className={FIELD}
            />
          </Field>
          <Field id="currency" label="Currency" error={errors.currency}>
            <input
              id="currency"
              name="currency"
              maxLength={3}
              placeholder="EUR"
              defaultValue={profile.currency ?? ''}
              className={FIELD}
            />
          </Field>
        </div>

        <Field id="familyStatus" label="Moving as" error={errors.familyStatus}>
          <select id="familyStatus" name="familyStatus" defaultValue={profile.familyStatus ?? ''} className={FIELD}>
            <option value="">—</option>
            <option value="single">single</option>
            <option value="couple">couple</option>
            <option value="family">family</option>
          </select>
        </Field>
      </div>

      <Submit />
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-[10rem] flex-1">
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-caption text-ink">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-8" disabled={pending}>
      {pending ? 'Saving…' : 'Save profile'}
    </Button>
  );
}
