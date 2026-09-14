import type { Role } from '@anomalia/contracts';
import { cn } from '@/shared/lib/cn';

/**
 * Roles carrying authority over other accounts or over published content are
 * marked; the commercial ladder is not.
 *
 * The distinction is the same one the backend policy draws, and it is drawn
 * visually for the same reason: in a list of a hundred accounts, the three
 * that can change other people's roles are the ones worth noticing.
 */
const PRIVILEGED: readonly Role[] = ['advisor', 'knowledge_manager', 'admin'];

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-0.5 text-caption',
        PRIVILEGED.includes(role)
          ? 'bg-ink text-surface'
          : 'border border-hairline/25 text-muted',
      )}
    >
      {role.replace(/_/g, ' ')}
    </span>
  );
}
