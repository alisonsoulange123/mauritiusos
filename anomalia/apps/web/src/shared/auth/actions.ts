'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { clientEnv } from '../config/client-env';
import { safeRedirect } from './safe-redirect';
import {
  REFRESH_COOKIE,
  REFRESH_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './session-cookie';

export interface AuthFormState {
  /** Rendered above the form. Never echoes which field was wrong on sign-in. */
  error?: string;
  /** Per-field messages, used by registration where specificity is helpful. */
  fieldErrors?: Record<string, string>;
}

const credentialsSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

const registrationSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  // Matches the API's own minimum. Validating here as well means the visitor
  // finds out before a round trip, not after.
  password: z.string().min(12, 'Use at least 12 characters.'),
  firstName: z.string().max(80).optional(),
});

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
});

/** Server-to-server call; no proxy involved, so the tenant header is explicit. */
async function callApi(path: string, body: unknown): Promise<Response> {
  return fetch(`${clientEnv.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-anomalia-tenant': clientEnv.NEXT_PUBLIC_DEFAULT_TENANT,
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

const messageFrom = async (response: Response, fallback: string): Promise<string> => {
  const payload: unknown = await response.json().catch(() => null);
  const parsed = z
    .object({ error: z.object({ message: z.string() }) })
    .safeParse(payload);
  return parsed.success ? parsed.data.error.message : fallback;
};

async function establishSession(response: Response): Promise<void> {
  const tokens = tokenResponseSchema.parse(await response.json());
  const store = await cookies();
  store.set(SESSION_COOKIE, tokens.access_token, sessionCookieOptions(tokens.expires_in));
  store.set(REFRESH_COOKIE, tokens.refresh_token, sessionCookieOptions(REFRESH_MAX_AGE_SECONDS));
}

export async function signIn(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const fields = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const response = await callApi('/auth/login', fields.data).catch(() => null);
  if (!response) return { error: 'Could not reach the service. Try again in a moment.' };

  if (!response.ok) {
    // One message for wrong password and unknown account alike: distinguishing
    // them turns the form into an account-enumeration oracle, which is also
    // why the API verifies against a dummy hash when the user is absent.
    return { error: await messageFrom(response, 'Those credentials were not accepted.') };
  }

  await establishSession(response);
  // Outside the guarded section on purpose — `redirect` signals by throwing.
  redirect(safeRedirect(formData.get('next')?.toString()));
}

export async function signUp(
  _previous: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const firstName = formData.get('firstName')?.toString().trim();
  const fields = registrationSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    ...(firstName ? { firstName } : {}),
  });
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const created = await callApi('/auth/register', fields.data).catch(() => null);
  if (!created) return { error: 'Could not reach the service. Try again in a moment.' };
  if (!created.ok) {
    return { error: await messageFrom(created, 'That account could not be created.') };
  }

  // Registration returns an id, not tokens, so sign in immediately. Sending
  // someone to a login form seconds after they typed the same password is a
  // drop-off for no security gain.
  const session = await callApi('/auth/login', {
    email: fields.data.email,
    password: fields.data.password,
  }).catch(() => null);

  if (!session?.ok) {
    // The account exists; only the automatic sign-in failed. Say so, rather
    // than implying the registration did not happen.
    redirect('/login?created=1');
  }

  await establishSession(session);
  redirect(safeRedirect(formData.get('next')?.toString()));
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;

  /*
   * Revoke server-side BEFORE clearing the cookies.
   *
   * Deleting them only removes this browser's copy; the refresh token itself
   * stays valid for thirty days. On a shared machine that would make signing
   * out close to meaningless, so the session lineage is ended where it lives.
   *
   * Failure is swallowed deliberately: the local cookies still get cleared, so
   * the visitor is signed out of this browser either way. Blocking the sign-out
   * on an unreachable API would leave them looking signed in.
   */
  if (refreshToken) {
    await callApi('/auth/logout', { refresh_token: refreshToken }).catch(() => null);
  }

  store.delete(SESSION_COOKIE);
  store.delete(REFRESH_COOKIE);
  redirect('/');
}

/* ── Account recovery ───────────────────────────────────────────────────── */

export interface RecoveryFormState extends AuthFormState {
  /** Rendered in place of the form once the step has succeeded. */
  done?: boolean;
}

const emailSchema = z.object({ email: z.string().email('Enter a valid email address.') });

const newPasswordSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.'),
    confirm: z.string(),
  })
  // Confirmation is a frontend concern only — the API has no opinion about a
  // second field. It is here because a mistyped password in a flow with no
  // "old password" to fall back on locks the account out a second time.
  .refine((fields) => fields.password === fields.confirm, {
    path: ['confirm'],
    message: 'Those passwords do not match.',
  });

/**
 * Step one: ask for a link.
 *
 * Shows the same confirmation for a registered address and an unknown one,
 * because the API answers both identically — that is what stops the form from
 * being a way to test whether someone has an account here. A transport
 * failure is still reported honestly; it says nothing about the address.
 */
export async function requestPasswordReset(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const fields = emailSchema.safeParse({ email: formData.get('email') });
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const response = await callApi('/auth/password/forgot', fields.data).catch(() => null);
  if (!response) return { error: 'Could not reach the service. Try again in a moment.' };

  if (!response.ok) {
    // In practice only the rate limiter lands here, and saying so is fine:
    // it reveals nothing about the address that was typed.
    return { error: await messageFrom(response, 'That request could not be completed.') };
  }

  return { done: true };
}

/** Step two: redeem the link and choose a new password. */
export async function resetPassword(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const token = formData.get('token')?.toString() ?? '';
  if (!token) return { error: 'That link is incomplete. Request a new one.' };

  const fields = newPasswordSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
  });
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const response = await callApi('/auth/password/reset', {
    token,
    password: fields.data.password,
  }).catch(() => null);
  if (!response) return { error: 'Could not reach the service. Try again in a moment.' };

  if (!response.ok) {
    return { error: await messageFrom(response, 'That reset link is no longer valid.') };
  }

  /*
   * Deliberately NOT signed in here.
   *
   * The API returns no tokens for a reset, so there is nothing to establish —
   * and that is the right shape: whoever followed the link proved they can
   * read a mailbox, not that they knew the old password. Making them sign in
   * with the password they just chose costs one screen and means a stolen
   * link alone is not a session.
   */
  redirect('/login?reset=1');
}

/**
 * Confirms an address from an emailed link.
 *
 * A server action rather than something the page runs on load, because mail
 * clients and security scanners follow links before a human does. A GET that
 * consumed the token would have it spent by a link checker, and the user would
 * arrive to find their own confirmation already used.
 */
export async function confirmEmail(
  _previous: RecoveryFormState,
  formData: FormData,
): Promise<RecoveryFormState> {
  const token = formData.get('token')?.toString() ?? '';
  if (!token) return { error: 'That link is incomplete. Request a new one from the portal.' };

  const response = await callApi('/auth/email/verify', { token }).catch(() => null);
  if (!response) return { error: 'Could not reach the service. Try again in a moment.' };

  if (!response.ok) {
    return { error: await messageFrom(response, 'That confirmation link is no longer valid.') };
  }

  return { done: true };
}

/** Sends the signed-in user another confirmation link. */
export async function resendVerification(
  _previous: RecoveryFormState,
  _formData: FormData,
): Promise<RecoveryFormState> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return { error: 'Sign in again to request a new link.' };

  const response = await fetch(
    `${clientEnv.NEXT_PUBLIC_API_BASE_URL}/auth/email/verification`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-anomalia-tenant': clientEnv.NEXT_PUBLIC_DEFAULT_TENANT,
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    },
  ).catch(() => null);

  if (!response) return { error: 'Could not reach the service. Try again in a moment.' };
  if (!response.ok) {
    return { error: await messageFrom(response, 'That request could not be completed.') };
  }

  return { done: true };
}

const fieldErrorsOf = (error: z.ZodError): Record<string, string> =>
  Object.fromEntries(
    error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]),
  );
