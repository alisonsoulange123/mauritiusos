import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '@reef-technologies/contracts';

export const IS_PUBLIC = 'reef_technologies:isPublic';
export const REQUIRED_ROLES = 'reef_technologies:requiredRoles';

/**
 * Opts a route out of authentication.
 *
 * Zero Trust means the guard is global and deny-by-default, so an endpoint is
 * protected unless someone explicitly writes `@Public()`. Forgetting a
 * decorator can only ever make a route *more* secure, never less.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** RBAC from the Security blueprint §5. Satisfied by holding ANY listed role. */
export const Roles = (...roles: Role[]) => SetMetadata(REQUIRED_ROLES, roles);

export interface AuthenticatedActor {
  userId: string;
  tenantId: string;
  roles: Role[];
  email: string;
}

/** Injects the verified actor. Never trust a body-supplied user id. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<{ actor?: AuthenticatedActor }>();
  return request.actor;
});
