import { Module } from '@nestjs/common';
import { IdentityController } from './interface/http/identity.controller.js';
import { RegisterUserUseCase } from './application/register-user.usecase.js';
import { AuthenticateUserUseCase } from './application/authenticate-user.usecase.js';
import { RefreshSessionUseCase } from './application/refresh-session.usecase.js';
import { RevokeSessionUseCase } from './application/revoke-session.usecase.js';
import { ChangeUserRoleUseCase } from './application/change-user-role.usecase.js';
import { IdentityContractImpl } from './application/identity.contract-impl.js';

@Module({
  controllers: [IdentityController],
  providers: [
    RegisterUserUseCase,
    AuthenticateUserUseCase,
    RefreshSessionUseCase,
    RevokeSessionUseCase,
    ChangeUserRoleUseCase,
    IdentityContractImpl,
  ],
})
export class IdentityModule {}
