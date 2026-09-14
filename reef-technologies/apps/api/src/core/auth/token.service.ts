import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DomainError, ERROR_CODES, type Role } from '@reef-technologies/contracts';
import { ConfigService } from '../config/config.service.js';
import type { SessionHandle } from './session-registry.js';

export interface IssueTokenInput {
  userId: string;
  tenantId: string;
  email: string;
  roles: Role[];
  /**
   * The session lineage these tokens belong to.
   *
   * `familyId` rides on BOTH tokens: the refresh token needs it to rotate, and
   * the access token needs it so the request guard can see that a revoked
   * session's still-unexpired access tokens are no longer valid.
   */
  session: SessionHandle;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Both tokens carry a `typ` claim and the guard requires `access`.
 *
 * Without it the two are interchangeable: a refresh token is signed with the
 * same key, so it would authenticate API calls for its full 30-day life —
 * turning the long-lived credential into a long-lived session and defeating
 * the point of a short access TTL.
 */
export const TOKEN_TYPE = { access: 'access', refresh: 'refresh' } as const;

interface RefreshClaims {
  sub: string;
  tid: string;
  typ?: string;
  /** Session family. Absent only on tokens minted before rotation existed. */
  fid?: string;
  /** This rotation's id — the value reuse detection compares. */
  jti?: string;
}

export interface RefreshSubject {
  userId: string;
  tenantId: string;
  familyId: string;
  tokenId: string;
}

/**
 * Mints and verifies tokens. Exposed to modules (the identity module calls it
 * on login) so that signing options, TTLs and the tenant claim live in exactly
 * one place.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(input: IssueTokenInput): Promise<TokenPair> {
    // `tid` in the token is what the guard checks against the host-resolved
    // tenant, so a stolen token cannot be replayed against another tenant.
    const claims = {
      sub: input.userId,
      email: input.email,
      roles: input.roles,
      tid: input.tenantId,
      typ: TOKEN_TYPE.access,
      fid: input.session.familyId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(claims, { expiresIn: this.config.core.JWT_ACCESS_TTL_SECONDS }),
      this.jwt.signAsync(
        {
          sub: input.userId,
          tid: input.tenantId,
          typ: TOKEN_TYPE.refresh,
          fid: input.session.familyId,
          jti: input.session.tokenId,
        },
        { expiresIn: this.config.core.JWT_REFRESH_TTL_SECONDS },
      ),
    ]);

    return { accessToken, refreshToken, expiresIn: this.config.core.JWT_ACCESS_TTL_SECONDS };
  }

  /**
   * Verifies a refresh token and returns only the subject it names.
   *
   * Deliberately returns no roles: they are re-read from the user record on
   * every refresh, so a role revoked mid-session takes effect within one access
   * TTL rather than persisting for the life of the refresh token.
   */
  async verifyRefresh(token: string): Promise<RefreshSubject> {
    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(token, {
        secret: this.config.core.JWT_SECRET,
      });
    } catch {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired session.', 401);
    }

    /*
     * A refresh token with no family cannot be rotated or revoked, so it is
     * refused rather than honoured. In practice that means tokens minted
     * before rotation existed: their holders sign in once more and get a
     * tracked session. Accepting them would leave an untracked credential
     * valid for thirty days, which is the exact hole this closes.
     */
    if (claims.typ !== TOKEN_TYPE.refresh || !claims.fid || !claims.jti) {
      throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 'Invalid or expired session.', 401);
    }

    return {
      userId: claims.sub,
      tenantId: claims.tid,
      familyId: claims.fid,
      tokenId: claims.jti,
    };
  }
}
