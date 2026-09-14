import { Module } from '@nestjs/common';
import { IdentityController } from './interface/http/identity.controller.js';
import { RegisterUserUseCase } from './application/register-user.usecase.js';
import { AuthenticateUserUseCase } from './application/authenticate-user.usecase.js';
import { RefreshSessionUseCase } from './application/refresh-session.usecase.js';
import { RevokeSessionUseCase } from './application/revoke-session.usecase.js';
import { ChangeUserRoleUseCase } from './application/change-user-role.usecase.js';
import { RequestPasswordResetUseCase } from './application/request-password-reset.usecase.js';
import { ResetPasswordUseCase } from './application/reset-password.usecase.js';
import { VerifyEmailUseCase } from './application/verify-email.usecase.js';
import { SendEmailVerificationUseCase } from './application/send-email-verification.usecase.js';
import { DescribeAccountUseCase } from './application/describe-account.usecase.js';
import { ListUsersUseCase } from './application/list-users.usecase.js';
import { GetUserDetailUseCase } from './application/get-user-detail.usecase.js';
import { IdentityContractImpl } from './application/identity.contract-impl.js';
import { PasswordHasher } from './infrastructure/password-hasher.js';
import { RecoveryMailer } from './infrastructure/recovery-mailer.js';

@Module({
  controllers: [IdentityController],
  providers: [
    RegisterUserUseCase,
    AuthenticateUserUseCase,
    RefreshSessionUseCase,
    RevokeSessionUseCase,
    ChangeUserRoleUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,
    VerifyEmailUseCase,
    SendEmailVerificationUseCase,
    DescribeAccountUseCase,
    ListUsersUseCase,
    GetUserDetailUseCase,
    IdentityContractImpl,
    PasswordHasher,
    RecoveryMailer,
  ],
})
export class IdentityModule {}
