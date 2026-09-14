import { Global, Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { MAILER } from './mailer.port.js';
import { LogMailer } from './log-mailer.js';
import { HttpMailer } from './http-mailer.js';

/**
 * Binds the one configured transport to the `MAILER` token.
 *
 * Global because mail is ambient infrastructure like the database — a module
 * that needs to send a message should inject the port, not import a module.
 */
@Global()
@Module({
  providers: [
    LogMailer,
    HttpMailer,
    {
      provide: MAILER,
      inject: [ConfigService, LogMailer, HttpMailer],
      useFactory: (config: ConfigService, log: LogMailer, http: HttpMailer) =>
        config.core.MAIL_TRANSPORT === 'http' ? http : log,
    },
  ],
  // LogMailer is exported as a concrete type so a test can read its outbox.
  // Production code injects MAILER and stays ignorant of which one it got.
  exports: [MAILER, LogMailer],
})
export class MailModule {}
