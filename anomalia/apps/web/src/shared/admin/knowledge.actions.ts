'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { ApiRequestError, apiRequest } from '../api/client';
import { readAccessToken } from '../auth/session';

export interface KnowledgeFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** A human sentence describing what just happened. */
  notice?: string;
}

const TYPES = ['RULE', 'GUIDE', 'LOCATION', 'PROCESS', 'FAQ', 'DOCUMENT'] as const;

const draftSchema = z.object({
  title: z.string().min(3, 'Give it a title of at least 3 characters.').max(200),
  type: z.enum(TYPES),
  category: z.string().min(2, 'Which area does this belong to?').max(60),
  content: z.string().min(1, 'There is nothing to say yet.').max(50_000),
  sourceId: z.string().uuid('Choose a source.').optional(),
  confidenceScore: z.coerce.number().int().min(0).max(100).optional(),
});

/**
 * Create a draft.
 *
 * Nothing here decides whether the result may be published — that is the
 * server's publication policy, checked at the moment it matters. This action
 * only has to get the text there.
 */
export async function createKnowledgeItem(
  _previous: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const fields = draftSchema.safeParse(readDraft(formData));
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const language = formData.get('language')?.toString();
  const created = await call<{ id: string }>('/knowledge', 'POST', {
    ...fields.data,
    ...(language === 'fr' ? { language } : {}),
  });

  if (!created.ok) return created.state;

  revalidatePath('/admin/knowledge');
  redirect(`/admin/knowledge/${created.value.id}`);
}

export async function updateKnowledgeItem(
  _previous: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const id = formData.get('id')?.toString();
  if (!id) return { error: 'That item could not be identified.' };

  const fields = draftSchema.safeParse(readDraft(formData));
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const result = await call<void>(`/knowledge/${id}`, 'PATCH', fields.data);
  if (!result.ok) return result.state;

  revalidatePath(`/admin/knowledge/${id}`);
  revalidatePath('/admin/knowledge');
  return { notice: 'Saved.' };
}

/**
 * Move an item through the lifecycle.
 *
 * The refusals this surfaces are the whole point of the feature — "publication
 * needs a source", "this item has never been verified" — so the API's sentence
 * is passed through verbatim rather than replaced with a generic failure. Each
 * one names a fix the editor can carry out in the next minute.
 */
export async function changeKnowledgeStatus(
  _previous: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const id = formData.get('id')?.toString();
  const status = formData.get('status')?.toString();
  if (!id || !status) return { error: 'That change could not be identified.' };

  const result = await call<{ from: string; to: string }>(`/knowledge/${id}/status`, 'PATCH', {
    status,
  });
  if (!result.ok) return result.state;

  revalidatePath(`/admin/knowledge/${id}`);
  revalidatePath('/admin/knowledge');
  return { notice: `Moved from ${result.value.from} to ${result.value.to}.` };
}

/** Records that somebody checked the item and it still holds. */
export async function verifyKnowledgeItem(
  _previous: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const id = formData.get('id')?.toString();
  if (!id) return { error: 'That item could not be identified.' };

  const confidence = formData.get('confidenceScore')?.toString();
  const result = await call<{ verified_at: string }>(`/knowledge/${id}/verify`, 'POST', {
    ...(confidence ? { confidenceScore: Number(confidence) } : {}),
  });
  if (!result.ok) return result.state;

  revalidatePath(`/admin/knowledge/${id}`);
  revalidatePath('/admin/knowledge');
  return { notice: 'Verified just now.' };
}

const sourceSchema = z.object({
  name: z.string().min(2, 'Name the source.').max(160),
  sourceType: z.enum(['government', 'partner', 'editorial', 'community']),
  authorityLevel: z.enum(['official', 'partner', 'editorial', 'community']),
  url: z.string().url('That is not a URL.').max(500).optional(),
});

export async function createKnowledgeSource(
  _previous: KnowledgeFormState,
  formData: FormData,
): Promise<KnowledgeFormState> {
  const url = formData.get('url')?.toString().trim();
  const fields = sourceSchema.safeParse({
    name: formData.get('name'),
    sourceType: formData.get('sourceType'),
    authorityLevel: formData.get('authorityLevel'),
    ...(url ? { url } : {}),
  });
  if (!fields.success) {
    return { error: 'Check the details below.', fieldErrors: fieldErrorsOf(fields.error) };
  }

  const result = await call<{ id: string }>('/knowledge/sources', 'POST', fields.data);
  if (!result.ok) return result.state;

  revalidatePath('/admin/knowledge/sources');
  return { notice: `Recorded "${fields.data.name}".` };
}

/** Reads the fields every draft form shares. */
function readDraft(formData: FormData) {
  const sourceId = formData.get('sourceId')?.toString();
  const confidence = formData.get('confidenceScore')?.toString();

  return {
    title: formData.get('title'),
    type: formData.get('type'),
    category: formData.get('category'),
    content: formData.get('content'),
    ...(sourceId ? { sourceId } : {}),
    ...(confidence ? { confidenceScore: confidence } : {}),
  };
}

/**
 * One request shape for every write here.
 *
 * Returns the failure rather than throwing it, so each action can hand the
 * API's own wording straight back to the form. Discriminated on `ok` rather
 * than on the presence of a key: `KnowledgeFormState` has only optional
 * properties, so `'error' in result` narrows nothing.
 */
type Outcome<T> = { ok: true; value: T } | { ok: false; state: KnowledgeFormState };

async function call<T>(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<Outcome<T>> {
  const token = await readAccessToken();
  if (!token) {
    return { ok: false, state: { error: 'Your session has expired. Sign in again.' } };
  }

  try {
    return { ok: true, value: await apiRequest<T>(path, { method, body, token, cache: 'no-store' }) };
  } catch (error) {
    if (error instanceof ApiRequestError) return { ok: false, state: { error: error.message } };
    return {
      ok: false,
      state: { error: 'Could not reach the service. Try again in a moment.' },
    };
  }
}

const fieldErrorsOf = (error: z.ZodError): Record<string, string> =>
  Object.fromEntries(error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]));
