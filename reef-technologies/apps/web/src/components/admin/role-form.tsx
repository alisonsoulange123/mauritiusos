'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ROLES, type Role } from '@reef-technologies/contracts';
import { Button } from '@/components/ui/button';
import { changeUserRole, type RoleChangeState } from '@/shared/admin/actions';

/**
 * The role-change control.
 *
 * It offers every role the platform defines rather than only the ones this
 * operator may assign. That is deliberate: the backend policy decides, and its
 * refusals say *why* — "only an administrator can assign that role", "that
 * account has not confirmed its email address". Hiding the options would
 * replace those explanations with an absence, and an advisor would be left
 * wondering whether the role exists at all.
 */
export function RoleForm({ userId, currentRole }: { userId: string; currentRole: Role }) {
  const [state, action] = useActionState<RoleChangeState, FormData>(changeUserRole, {});

  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="userId" value={userId} />

      {state.error ? (
        <p role="alert" className="mb-4 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {state.error}
        </p>
      ) : null}

      {state.result ? (
        <p role="status" className="mb-4 border-l-2 border-ink py-1 pl-3 text-caption text-ink">
          {outcomeOf(state.result)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="text-caption font-medium text-ink">Role</span>
          <select
            name="role"
            defaultValue={currentRole}
            className="mt-2 block rounded-lg border border-hairline/[0.16] bg-surface px-3 py-2.5 text-body text-ink focus:border-ink/50"
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        <Submit />
      </div>
    </form>
  );
}

/**
 * What actually happened, in the operator's terms.
 *
 * The no-op case gets its own sentence. The API reports `from` and `to` as
 * equal and revokes nothing, and rendering that as "changed from advisor to
 * advisor" would claim an action that did not occur — which matters on a
 * screen whose entire job is to be a truthful record of administrative acts.
 *
 * The session count is stated for the same reason: roles live in access
 * tokens, so a change only takes effect by ending sessions, and the operator
 * should learn that here rather than from the customer.
 */
function outcomeOf(result: NonNullable<RoleChangeState['result']>): string {
  if (result.from === result.to) {
    return `No change — that account was already ${result.to.replace(/_/g, ' ')}.`;
  }

  const consequence =
    result.sessionsRevoked > 0
      ? `${result.sessionsRevoked} session${
          result.sessionsRevoked === 1 ? ' was' : 's were'
        } ended, so they will need to sign in again.`
      : 'They had no active session.';

  return `Role changed from ${result.from} to ${result.to}. ${consequence}`;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Applying…' : 'Apply'}
    </Button>
  );
}
