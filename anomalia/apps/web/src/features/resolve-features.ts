import type { Role } from '@anomalia/contracts';
import { FEATURE_REGISTRY } from './registry';
import type { FeatureDefinition } from './feature.definition';
import type { Capabilities } from '@/shared/capabilities/capabilities';
import { clientEnv } from '@/shared/config/client-env';

export interface ResolveContext {
  capabilities: Capabilities;
  roles: Role[];
  authenticated: boolean;
}

export interface ResolvedFeature {
  definition: FeatureDefinition;
  visible: boolean;
  /** Why it is hidden — surfaced in the dev-tools panel, never to end users. */
  reason?: 'module-disabled' | 'role-missing' | 'requires-auth';
}

/**
 * Decides what this viewer can see, from three independent inputs.
 *
 * Layered deliberately, cheapest and most authoritative first:
 *
 *   1. Backend capability — does the API even serve this module? If not, the
 *      feature is hidden regardless of anything else. A local override cannot
 *      conjure an endpoint that does not exist.
 *   2. Authentication — public features survive; the rest do not.
 *   3. Role — RBAC from the Security blueprint §5.
 *
 * The dev override in step 1 only ever *narrows* for testing: it lets you
 * preview a feature locally when the backend flag is on but you want to check
 * an isolated nav state. It cannot widen access.
 */
export function resolveFeatures(context: ResolveContext): ResolvedFeature[] {
  const enabledModules = new Set(context.capabilities.enabled);
  const overrides = new Set(
    clientEnv.NEXT_PUBLIC_FLAG_OVERRIDES.split(',').map((entry) => entry.trim()).filter(Boolean),
  );

  return FEATURE_REGISTRY.map((definition) => {
    const modulesReady = definition.requiresModules.every((key) => enabledModules.has(key));
    if (!modulesReady && !overrides.has(definition.key)) {
      return { definition, visible: false, reason: 'module-disabled' as const };
    }

    if (!context.authenticated && !definition.public) {
      return { definition, visible: false, reason: 'requires-auth' as const };
    }

    const requiredRoles = definition.requiresRoles ?? [];
    if (requiredRoles.length && !requiredRoles.some((role) => context.roles.includes(role))) {
      return { definition, visible: false, reason: 'role-missing' as const };
    }

    return { definition, visible: true };
  });
}

/** Nav items, ordered. Hidden and non-nav features are excluded. */
export function navigationFor(resolved: ResolvedFeature[]) {
  return resolved
    .filter((entry) => entry.visible && entry.definition.nav && !entry.definition.nav.hidden)
    .sort((a, b) => (a.definition.nav?.order ?? 0) - (b.definition.nav?.order ?? 0))
    .map((entry) => ({
      key: entry.definition.key,
      title: entry.definition.title,
      href: `/portal/${entry.definition.key}`,
      icon: entry.definition.nav?.icon ?? 'circle',
    }));
}
