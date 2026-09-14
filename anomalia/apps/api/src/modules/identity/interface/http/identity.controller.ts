import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
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
import { RequestPasswordResetUseCase } from '../../application/request-password-reset.usecase.js';
import { ResetPasswordUseCase } from '../../application/reset-password.usecase.js';
import { VerifyEmailUseCase } from '../../application/verify-email.usecase.js';
import { SendEmailVerificationUseCase } from '../../application/send-email-verification.usecase.js';
import { DescribeAccountUseCase } from '../../application/describe-account.usecase.js';
import { ListUsersUseCase } from '../../application/list-users.usecase.js';
import { GetUserDetailUseCase } from '../../application/get-user-detail.usecase.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(200),
  firstName: z.string().min(1).max(80).optional(),
  language: z.enum(['en', 'fr']).optional(),
  source: z.string().max(60).optional(),
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

const forgotPasswordSchema = z.object({ email: z.string().email() });

const resetPasswordSchema = z.object({
  token: z.string().min(1).max(400),
  // Mirrors registration. The real floor is the module's configured minimum,
  // enforced by the hasher before the single-use link is spent.
  password: z.string().min(12).max(200),
});

const verifyEmailSchema = z.object({ token: z.string().min(1).max(400) });

const userDirectorySchema = z.object({
  search: z.string().max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['pending', 'active', 'suspended']).optional(),
  // Accepts the string a query param actually carries.
  unverifiedOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

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
    private readonly requestReset: RequestPasswordResetUseCase,
    private readonly resetPassword: ResetPasswordUseCase,
    private readonly verifyEmail: VerifyEmailUseCase,
    private readonly sendVerification: SendEmailVerificationUseCase,
    private readonly describeAccount: DescribeAccountUseCase,
    private readonly listUsers: ListUsersUseCase,
    private readonly userDetail: GetUserDetailUseCase,
    private readonly tenantContext: TenantContext,
  ) {}

  @Public()
  // Credential endpoints get the tight bucket: 10/min, not 120/min.
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
   * Account recovery, step one.
   *
   * Always 202, always the same body, whether or not the address is
   * registered. The alternative — 404 for an unknown address — turns this form
   * into a way to test a breach dump against the customer list.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password/forgot')
  @HttpCode(202)
  @ApiOperation({ summary: 'Send a password reset link' })
  async forgotPassword(@Body(zodBody(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.requestReset.execute(body.email);
    return { status: 'sent' };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('password/reset')
  @ApiOperation({ summary: 'Set a new password using a reset link' })
  async completePasswordReset(@Body(zodBody(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>) {
    const result = await this.resetPassword.execute(body.token, body.password);
    // No tokens in the response: whoever holds a reset link has proved access
    // to a mailbox, not knowledge of the old password, so they sign in like
    // anyone else. Handing back a session here would make a stolen link a
    // one-step takeover.
    return { status: 'reset', sessions_revoked: result.sessionsRevoked };
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('email/verify')
  @ApiOperation({ summary: 'Confirm an email address' })
  async confirmEmail(@Body(zodBody(verifyEmailSchema)) body: z.infer<typeof verifyEmailSchema>) {
    const result = await this.verifyEmail.execute(body.token);
    return {
      user_id: result.userId,
      status: result.changed ? 'verified' : 'already_verified',
    };
  }

  /**
   * Authenticated, and only ever to the caller's own address.
   *
   * A public resend endpoint taking an email would let anyone have the
   * platform send mail to anyone, repeatedly, and would confirm which
   * addresses exist while doing it.
   */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post('email/verification')
  @HttpCode(202)
  @ApiOperation({ summary: 'Resend your own confirmation link' })
  async resendVerification(@CurrentActor() actor: AuthenticatedActor) {
    const result = await this.sendVerification.execute(actor.userId);
    return { status: result.alreadyVerified ? 'already_verified' : 'sent' };
  }

  /**
   * The account directory behind the Back Office.
   *
   * Open to advisors as well as admins, because finding the customer you are
   * about to promote is the same job as promoting them — gating the list to
   * admins would leave advisors with an endpoint they can call and no way to
   * discover what to call it with.
   */
  @Roles('advisor', 'admin')
  @Get('users')
  @ApiOperation({ summary: 'List accounts (cursor paginated, newest first)' })
  async listAccounts(@Query(zodBody(userDirectorySchema)) query: z.infer<typeof userDirectorySchema>) {
    const page = await this.listUsers.execute(query);
    return {
      items: page.items.map((user) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        email_verified: user.emailVerified,
        first_name: user.firstName,
        last_name: user.lastName,
        created_at: user.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Roles('advisor', 'admin')
  @Get('users/:id')
  @ApiOperation({ summary: 'One account, with profile and live session count' })
  async accountDetail(@Param('id', ParseUUIDPipe) id: string) {
    const user = await this.userDetail.execute(id);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      email_verified: user.emailVerified,
      email_verified_at: user.emailVerifiedAt?.toISOString() ?? null,
      locale: user.locale,
      created_at: user.createdAt.toISOString(),
      profile: user.profile,
      active_sessions: user.activeSessions,
    };
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
    @Param('id', ParseUUIDPipe) id: string,
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
  async me(@CurrentActor() actor: AuthenticatedActor) {
    const account = await this.describeAccount.execute(actor.userId);
    return {
      id: account.id,
      email: account.email,
      roles: account.roles,
      email_verified: account.emailVerified,
    };
  }
}
