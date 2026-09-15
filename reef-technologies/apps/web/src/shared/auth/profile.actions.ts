'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ApiRequestError, apiRequest } from '../api/client';
import { readAccessToken } from './session';

export interface ProfileFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  notice?: string;
}

/**
 * Blank means "not answered", not "set to empty".
 *
 * A PATCH that omitted a field would leave it alone, so clearing a value needs
 * to be expressible — an empty input is therefore sent as an explicit null
 * rather than dropped.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

const profileSchema = z.object({
  firstName: optionalText(80),
  lastName: optionalText(80),
  nationality: optionalText(2).refine((v) => v === null || /^[A-Za-z]{2}$/.test(v), {
    message: 'Use a two-letter country code, such as FR.',
  }),
  currentCountry: optionalText(2).refine((v) => v === null || /^[A-Za-z]{2}$/.test(v), {
    message: 'Use a two-letter country code, such as MU.',
  }),
  birthDate: optionalText(10).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'Use the format YYYY-MM-DD.',
  }),
  occupation: optionalText(60),
  currency: optionalText(3).refine((v) => v === null || /^[A-Za-z]{3}$/.test(v), {
    message: 'Use a three-letter currency code, such as EUR.',
  }),
  familyStatus: z
    .enum(['single', 'couple', 'family', ''])
    .transform((value) => (value === '' ? null : value))
    .nullable(),
  monthlyIncome: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : Number(value)))
    .refine((value) => value === null || (Number.isFinite(value) && value >= 0), {
      message: 'Enter a whole number, or leave it blank.',
    }),
});

/**
 * Saves the person's own profile.
 *
 * These are not decorative fields: the immigration rules engine matches on
 * nationality, age, income and family status, and the concierge restates its
 * verdict rather than inventing one. An empty profile is why a signed-in user
 * used to get no eligibility answer at all.
 */
export async function saveProfile(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const fields = profileSchema.safeParse(Object.fromEntries(formData));
  if (!fields.success) {
    return {
      error: 'Check the details below.',
      fieldErrors: Object.fromEntries(
        fields.error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]),
      ),
    };
  }

  const token = await readAccessToken();
  if (!token) return { error: 'Your session has expired. Sign in again.' };

  try {
    await apiRequest('/auth/profile', {
      method: 'PATCH',
      body: fields.data,
      token,
      cache: 'no-store',
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return { error: error.message };
    return { error: 'Could not reach the service. Try again in a moment.' };
  }

  revalidatePath('/portal/profile');
  return { notice: 'Saved.' };
}
