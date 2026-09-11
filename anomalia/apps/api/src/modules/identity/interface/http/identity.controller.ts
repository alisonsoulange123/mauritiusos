import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ROLES } from '@anomalia/contracts';
import { CurrentActor, Public, Roles, type AuthenticatedActor } from '../../../../core/auth/auth.decorators.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { TenantContext } from '../../../../core/tenancy/tenant-context.js';
import { RegisterUserUseCase } from '../../application/register-user.usecase.js';
import { AuthenticateUserUseCase } from '../../application/authenticate-user.usecase.js';
import { RefreshSessionUseCase } from '../../application/refresh-session.usecase.js';
import { RevokeSessionUseCase } from '../../application/revoke-session.usecase.js';
import { ChangeUserRoleUseCase } from '../../application/change-user-role.usecase.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  firstName: z.string().min(1).max(80).optional(),
  language: z.enum(['en', 'fr']).optional(),
  source: z.string().max(60).optional(),
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

// The enum is the allowlist: an unknown role is rejected before it reaches the
// policy, so the policy only ever reasons about roles that exist.
const roleSchema = z.object({ role: z.enum(ROLES) });

/** Routes match the API Contract Blueprint §4 exactly. */
@ApiTags('auth')
@Controller('auth')
export class IdentityController {
  constructor(
    private readonly register: RegisterUserUseCase,
    private readonly authenticate: AuthenticateUserUseCase,
    private readonly refresh: RefreshSessionUseCase,
    private readonly revoke: RevokeSessionUseCase,
    private readonly changeRole: ChangeUserRoleUseCase,
    private readonly tenantContext: TenantContext,
  ) {}

  @Public()
  // Credential endpoints get the tight bucket: 10/min, not 120/min.
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @Post('register')
  @ApiOperation({ summary: 'Create an account' })
  async registerUser(@Body(zodBody(registerSchema)) body: z.infer<typeof registerSchema>) {
    const result = await this.register.execute({
      email: body.email,
      password: body.password,
      ...(body.firstName ? { firstName: body.firstName } : {}),
      locale: body.language ?? this.tenantContext.locale(),
      ...(body.source ? { acquisitionSource: body.source } : {}),
    });
    return { user_id: result.userId, status: 'created', next_step: 'complete_profile' };
  }

  @Public()
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @Post('login')
  @ApiOperation({ summary: 'Exchange credentials for tokens' })
  async login(@Body(zodBody(loginSchema)) body: z.infer<typeof loginSchema>) {
    const result = await this.authenticate.execute(body.email, body.password);
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: result.expiresIn,
      user: { id: result.userId, role: result.role },
    };
  }

  @Public()
  // Same tight bucket as login: this endpoint mints credentials too.
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  async refreshSession(@Body(zodBody(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    const result = await this.refresh.execute(body.refresh_token);
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      expires_in: result.expiresIn,
      user: { id: result.userId, role: result.role },
    };
  }

  @Public()
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the session behind a refresh token' })
  async logout(@Body(zodBody(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    // Public because a session whose access token has already expired must
    // still be revocable — requiring a valid access token to sign out would
    // strand exactly the sessions most worth ending.
    await this.revoke.execute(body.refresh_token);
  }

  /**
   * The lead → client transition.
   *
   * `@Roles` is the coarse gate — it keeps the endpoint off the public
   * surface — and the real rules live in the domain policy, which decides what
   * THIS actor may assign to THIS target. An advisor passing this decorator
   * still cannot mint an admin.
   */
  @Roles('advisor', 'admin')
  @Patch('users/:id/role')
  @ApiOperation({ summary: "Change a user's role" })
  async setUserRole(
    @Param('id') id: string,
    @Body(zodBody(roleSchema)) body: z.infer<typeof roleSchema>,
    @CurrentActor() actor: AuthenticatedActor,
  ) {
    const result = await this.changeRole.execute({
      targetUserId: id,
      role: body.role,
      actorId: actor.userId,
      actorRoles: actor.roles,
    });

    return {
      user_id: result.userId,
      from: result.from,
      to: result.to,
      // Surfaced because it is a visible consequence: the user must sign in
      // again, and whoever made the change should know that before support does.
      sessions_revoked: result.sessionsRevoked,
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'The authenticated actor' })
  me(@CurrentActor() actor: AuthenticatedActor) {
    return { id: actor.userId, email: actor.email, roles: actor.roles };
  }
}
