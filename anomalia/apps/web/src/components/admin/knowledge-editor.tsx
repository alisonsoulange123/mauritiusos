'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  createKnowledgeItem,
  updateKnowledgeItem,
  type KnowledgeFormState,
} from '@/shared/admin/knowledge.actions';
import type { KnowledgeItem, SourceRow } from '@/shared/admin/knowledge.api';

const TYPES = ['RULE', 'GUIDE', 'LOCATION', 'PROCESS', 'FAQ', 'DOCUMENT'] as const;
const EMPTY: KnowledgeFormState = {};

const FIELD =
  'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:border-ink/50';

/**
 * One editor for writing and for revising.
 *
 * Two forms differing by a hidden id and a verb is how the validation on one
 * drifts from the other — and here that would mean an item creatable with a
 * shape it could never be saved with.
 */
export function KnowledgeEditor({
  item,
  sources,
}: {
  item?: KnowledgeItem;
  sources: SourceRow[];
}) {
  const [state, action] = useActionState<KnowledgeFormState, FormData>(
    item ? updateKnowledgeItem : createKnowledgeItem,
    EMPTY,
  );

  const value = defaultsFor(item);
  const errors = state.fieldErrors ?? {};
  const isEditing = item !== undefined;

  return (
    <form action={action} className="mt-8">
      {isEditing ? <input type="hidden" name="id" value={value.id} /> : null}

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
        <Field id="title" label="Title" error={errors.title}>
          <input id="title" name="title" required defaultValue={value.title} className={FIELD} />
        </Field>

        <div className="flex flex-wrap gap-5">
          <Field id="type" label="Type" error={errors.type}>
            <select id="type" name="type" defaultValue={value.type} className={FIELD}>
              {TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>

          <Field id="category" label="Category" error={errors.category}>
            <input
              id="category"
              name="category"
              required
              placeholder="immigration"
              defaultValue={value.category}
              className={FIELD}
            />
          </Field>

          {/* Language is fixed after creation: the slug is unique per
              (tenant, slug, locale), so changing it would silently move the
              item into a different uniqueness bucket. A translation is a new
              item that happens to share a slug. */}
          {isEditing ? null : (
            <Field id="language" label="Language">
              <select id="language" name="language" defaultValue="en" className={FIELD}>
                <option value="en">en</option>
                <option value="fr">fr</option>
              </select>
            </Field>
          )}
        </div>

        <Field
          id="sourceId"
          label="Source"
          error={errors.sourceId}
          hint="Required before it can be published."
        >
          <select id="sourceId" name="sourceId" defaultValue={value.sourceId} className={FIELD}>
            <option value="">— none —</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} ({source.authorityLevel})
              </option>
            ))}
          </select>
        </Field>

        <Field
          id="confidenceScore"
          label="Confidence"
          error={errors.confidenceScore}
          hint="0–100. Below the search floor an item is published and invisible."
        >
          <input
            id="confidenceScore"
            name="confidenceScore"
            type="number"
            min={0}
            max={100}
            defaultValue={value.confidenceScore}
            className={FIELD}
          />
        </Field>

        <Field id="content" label="Content" error={errors.content}>
          <textarea
            id="content"
            name="content"
            required
            rows={14}
            defaultValue={value.content}
            className={`${FIELD} font-mono text-caption leading-relaxed`}
          />
        </Field>
      </div>

      <Submit label={isEditing ? 'Save' : 'Create draft'} />
    </form>
  );
}

/** What a brand-new draft starts from. */
const BLANK = {
  id: '',
  title: '',
  type: 'GUIDE',
  category: '',
  sourceId: '',
  confidenceScore: 80,
  content: '',
};

/**
 * Every field's starting value, resolved in one place.
 *
 * There is one decision here — is this a new item or an existing one — so it
 * is written as one branch. Reaching for `item?.x ?? fallback` per field turns
 * that single question into seven, which reads as if each field could
 * independently be absent and counts as seven branches against the project's
 * complexity ceiling.
 */
function defaultsFor(item?: KnowledgeItem): typeof BLANK {
  if (!item) return BLANK;

  return {
    id: item.id,
    title: item.title,
    type: item.type,
    category: item.category,
    // The only genuinely optional one: an item may cite no source yet.
    sourceId: item.sourceId ?? '',
    confidenceScore: item.confidenceScore,
    content: item.content,
  };
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
    <div className="min-w-[12rem] flex-1">
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

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="mt-8" disabled={pending}>
      {pending ? 'Working…' : label}
    </Button>
  );
}
