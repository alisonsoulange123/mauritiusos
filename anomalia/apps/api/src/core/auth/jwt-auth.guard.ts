import type { CanActivate, ExecutionContext} from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DomainError, ERROR_CODES, ROLES, type Role } from '@anomalia/contracts';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { IS_PUBLIC, REQUIRED_ROLES, type AuthenticatedActor } from './auth.decorators.js';
import { TOKEN_TYPE } from './token.service.js';
import { SessionRegistry } from './session-registry.js';

interface AccessTokenClaims {
  sub: string;
  email: string;
  /** Absent on a refresh token, which is why this is not `string[]`. */
  roles?: string[];
  tid: string;
  typ?: string;
  /** Session family, so a revoked session's live access tokens stop working. */
  fid?: string;
}

/**
 * Global authentication + authorization guard. Deny by default.
 *
 * Registered with `APP_GUARD`, so it runs on every route in every module —
 * including modules written later by people who never read this file. A new
 * module's endpoints are protected the moment they exist.
 *
 * Also enforces the tenant/token match: a token minted for tenant A presented
 * against tenant B's host is rejected, which closes the obvious cross-tenant
 * escalation path in a shared-infrastructure deployment.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly tenantContext: TenantContext,
    private readonly sessions: SessionRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlers = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, handlers) ?? false;
    const request = context.switchToHttp().getRequest<Request & { actor?: AuthenticatedActor }>();

    const token = extractBearer(request.headers.authorization);

    // A public route still resolves the actor when a token is present: the
    // assessment funnel personalises for logged-in visitors without requiring
    // a login.
    if (!token) return rejectUnlessPublic(isPublic, 'Authentication required.');

    const claims = await this.verifyAccess(token);
    if (!claims) return rejectUnlessPublic(isPublic, 'Invalid or expired token.');

    /*
     * Signature and expiry are not enough once sessions can be revoked.
     *
     * An access token is stateless and lives for 15 minutes, so a security
     * logout that only invalidated refresh tokens would leave the attacker's
     * current access token working for the rest of its life — revocation in
     * name only. This is the lookup that makes it real. It costs one Redis
     * round trip per authenticated request; see `SessionRegistry.isRevoked`
     * for why that lookup fails open rather than closed.
     */
    if (claims.fid && (await this.sessions.isRevoked(claims.fid))) {
      return rejectUnlessPublic(isPublic, 'This session has been revoked.');
    }

    const scope = this.tenantContext.current();
    this.assertTenantMatch(claims, scope);

    const actor = bindActor(request, claims, scope);
    assertRoles(actor.roles, this.reflector.getAllAndOverride<Role[]>(REQUIRED_ROLES, handlers) ?? []);

    return true;
  }

  /**
   * Verifies the signature AND the token type.
   *
   * Returns null rather than throwing so the caller can decide, since a public
   * route treats a bad token as "anonymous" while a protected one treats it as
   * a 401.
   */
  private async verifyAccess(token: string): Promise<AccessTokenClaims | null> {
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.core.JWT_SECRET,
      });
    } catch {
      return null;
    }

    /*
     * Refresh tokens are signed with the same key, so without this check one
     * would authenticate any request for its full 30-day life. Rejecting by
     * type also stops the crash that used to follow: a refresh token has no
     * `roles` claim, so the filter below threw a TypeError and the caller got
     * a 500 where a 401 was the honest answer.
     */
    if (claims.typ !== TOKEN_TYPE.access || !Array.isArray(claims.roles)) return null;

    return claims;
  }

  private assertTenantMatch(claims: AccessTokenClaims, scope: TenantScope | undefined): void {
    if (!scope || claims.tid === scope.tenantId) return;

    this.logger.warn(
      `token/tenant mismatch: token tid=${claims.tid} host tenant=${scope.tenantId} (trace ${scope.traceId})`,
    );
    throw new DomainError(ERROR_CODES.FORBIDDEN, 'Token is not valid for this tenant.', 403);
  }
}

/** The subset of the tenant scope this guard reads and writes. */
type TenantScope = NonNullable<ReturnType<TenantContext['current']>>;

const rejectUnlessPublic = (isPublic: boolean, message: string): boolean => {
  if (isPublic) return true;
  throw new DomainError(ERROR_CODES.UNAUTHENTICATED, message, 401);
};

function bindActor(
  request: Request & { actor?: AuthenticatedActor },
  claims: AccessTokenClaims,
  scope: TenantScope | undefined,
): AuthenticatedActor {
  // Unrecognised roles are dropped, not carried: a role the contract does not
  // name must never satisfy a check by being an opaque string.
  const roles = (claims.roles ?? []).filter((role): role is Role =>
    (ROLES as readonly string[]).includes(role),
  );

  const actor: AuthenticatedActor = {
    userId: claims.sub,
    tenantId: claims.tid,
    email: claims.email,
    roles,
  };

  request.actor = actor;
  if (scope) {
    scope.actorId = actor.userId;
    scope.roles = roles;
  }
  return actor;
}

const assertRoles = (held: Role[], required: Role[]): void => {
  if (!required.length || required.some((role) => held.includes(role))) return;
  throw new DomainError(ERROR_CODES.FORBIDDEN, `Requires one of: ${required.join(', ')}.`, 403);
};

const extractBearer = (header: string | undefined): string | undefined => {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
};
