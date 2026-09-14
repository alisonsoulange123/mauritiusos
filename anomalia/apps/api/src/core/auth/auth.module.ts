import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '../config/config.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { TokenService } from './token.service.js';
import { SessionRegistry } from './session-registry.js';
import { RecoveryTokenService } from './recovery-tokens.js';

/**
 * Core owns token VERIFICATION; the identity module owns user records and
 * credential checks. That split is deliberate — every module needs to trust a
 * token, but only one module should know what a password is.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.core.JWT_SECRET,
        signOptions: { expiresIn: config.core.JWT_ACCESS_TTL_SECONDS, issuer: 'anomalia' },
      }),
    }),
  ],
  providers: [
    TokenService,
    SessionRegistry,
    RecoveryTokenService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService, SessionRegistry, RecoveryTokenService, JwtModule],
})
export class AuthModule {}
