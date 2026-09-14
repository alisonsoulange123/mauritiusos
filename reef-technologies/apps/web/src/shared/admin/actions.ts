'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { ROLES } from '@reef-technologies/contracts';
import { ApiRequestError, apiRequest } from '../api/client';
import { readAccessToken } from '../auth/session';

export interface RoleChangeState {
  error?: string;
  /** Set on success so the page can report what actually happened. */
  result?: { from: string; to: string; sessionsRevoked: number };
}

const roleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});

/**
 * Changes an account's role.
 *
 * This action deliberately does almost nothing: it forwards to the API and
 * reports back. Every rule about who may assign what lives in the backend
 * policy, because a check here would protect only the people who use this
 * form — and the endpoint is reachable without it.
 *
 * What it does own is telling the truth afterwards. The API reports how many
 * sessions it ended, and that number is the visible consequence of the change:
 * the person has been signed out of that many devices and will have to sign in
 * again. An operator who is not told that will hear about it from support.
 */
export async function changeUserRole(
  _previous: RoleChangeState,
  formData: FormData,
): Promise<RoleChangeState> {
  const fields = roleChangeSchema.safeParse({
    userId: formData.get('userId'),
    role: formData.get('role'),
  });
  if (!fields.success) return { error: 'That role is not one this platform recognises.' };

  const token = await readAccessToken();
  if (!token) return { error: 'Your session has expired. Sign in again.' };

  try {
    const response = await apiRequest<{ from: string; to: string; sessions_revoked: number }>(
      `/auth/users/${fields.data.userId}/role`,
      { method: 'PATCH', body: { role: fields.data.role }, token, cache: 'no-store' },
    );

    // The detail page reads the account server-side; without this it would
    // render the role the operator just replaced.
    revalidatePath(`/admin/users/${fields.data.userId}`);
    revalidatePath('/admin/users');

    return {
      result: {
        from: response.from,
        to: response.to,
        sessionsRevoked: response.sessions_revoked,
      },
    };
  } catch (error) {
    /*
     * The API's refusals are written for a human and are the useful answer
     * here — "that account has not confirmed its email address yet" tells an
     * advisor exactly what to do next, where a generic failure would send them
     * to support. Passing the message through is safe because every refusal on
     * this endpoint is about the actor's own authority or the target's state,
     * both of which the caller is entitled to know.
     */
    if (error instanceof ApiRequestError) return { error: error.message };
    return { error: 'Could not reach the service. Try again in a moment.' };
  }
}
