'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import {
  changeKnowledgeStatus,
  verifyKnowledgeItem,
  type KnowledgeFormState,
} from '@/shared/admin/knowledge.actions';
import type { KnowledgeStatus } from '@/shared/admin/knowledge.api';

const EMPTY: KnowledgeFormState = {};

/** What each move means, so a button is not just a state name. */
const INTENT: Record<KnowledgeStatus, string> = {
  draft: 'Return to draft',
  review: 'Send for review',
  published: 'Publish',
  archived: 'Archive',
};

/**
 * The lifecycle buttons.
 *
 * The available moves come from the server, which derived them from the same
 * policy that will judge the request — so this cannot offer a transition that
 * is then refused. What it does NOT try to predict is whether a publication
 * will pass the provenance and freshness rules: that answer belongs to the
 * server at the moment of the attempt, and its refusal explains itself better
 * than a greyed-out button ever could.
 */
export function LifecycleControls({
  id,
  nextStates,
}: {
  id: string;
  nextStates: KnowledgeStatus[];
}) {
  const [state, action] = useActionState<KnowledgeFormState, FormData>(
    changeKnowledgeStatus,
    EMPTY,
  );

  return (
    <div className="mt-5">
      {state.error ? (
        <p role="alert" className="mb-4 max-w-prose border-l-2 border-ink py-1 pl-3 text-caption text-ink text-pretty">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="mb-4 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.notice}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {nextStates.map((status) => (
          <form key={status} action={action}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="status" value={status} />
            <TransitionButton label={INTENT[status]} primary={status === 'published'} />
          </form>
        ))}
      </div>
    </div>
  );
}

function TransitionButton({ label, primary }: { label: string; primary: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={primary ? 'primary' : 'secondary'} disabled={pending}>
      {pending ? '…' : label}
    </Button>
  );
}

/** Recording a check is its own act, not a side effect of editing. */
export function VerifyControl({ id, confidence }: { id: string; confidence: number }) {
  const [state, action] = useActionState<KnowledgeFormState, FormData>(
    verifyKnowledgeItem,
    EMPTY,
  );

  return (
    <form action={action} className="mt-5 flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />

      <label>
        <span className="text-caption font-medium text-ink">Confidence after checking</span>
        <input
          name="confidenceScore"
          type="number"
          min={0}
          max={100}
          defaultValue={confidence}
          className="mt-2 block w-28 rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2.5 text-body text-ink focus:border-ink/50"
        />
      </label>

      <VerifyButton />

      {state.error ? <p className="text-caption text-ink">{state.error}</p> : null}
      {state.notice ? <p className="text-caption text-muted">{state.notice}</p> : null}
    </form>
  );
}

function VerifyButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      {pending ? '…' : 'Mark verified'}
    </Button>
  );
}
