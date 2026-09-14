'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  createKnowledgeSource,
  type KnowledgeFormState,
} from '@/shared/admin/knowledge.actions';

const FIELD =
  'mt-2 w-full rounded-lg border border-hairline/[0.16] bg-surface px-3.5 py-2.5 text-body text-ink placeholder:text-muted focus:border-ink/50';

const EMPTY: KnowledgeFormState = {};

export function SourceForm() {
  const [state, action] = useActionState<KnowledgeFormState, FormData>(
    createKnowledgeSource,
    EMPTY,
  );

  return (
    <form action={action} className="mt-5 max-w-lg">
      {state.error ? (
        <p role="alert" className="mb-4 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="mb-4 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.notice}
        </p>
      ) : null}

      <div className="space-y-4">
        <div>
          <label htmlFor="name" className="text-caption font-medium text-ink">
            Name
          </label>
          <input id="name" name="name" required placeholder="Economic Development Board" className={FIELD} />
          {state.fieldErrors?.name ? (
            <p className="mt-1.5 text-caption text-ink">{state.fieldErrors.name}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="url" className="text-caption font-medium text-ink">
            URL
          </label>
          <input id="url" name="url" type="url" placeholder="https://…" className={FIELD} />
          {state.fieldErrors?.url ? (
            <p className="mt-1.5 text-caption text-ink">{state.fieldErrors.url}</p>
          ) : null}
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label htmlFor="sourceType" className="text-caption font-medium text-ink">
              Kind
            </label>
            <select id="sourceType" name="sourceType" defaultValue="government" className={FIELD}>
              {['government', 'partner', 'editorial', 'community'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label htmlFor="authorityLevel" className="text-caption font-medium text-ink">
              Authority
            </label>
            <select id="authorityLevel" name="authorityLevel" defaultValue="official" className={FIELD}>
              {['official', 'partner', 'editorial', 'community'].map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="mt-6" disabled={pending}>
      {pending ? 'Recording…' : 'Record source'}
    </Button>
  );
}
