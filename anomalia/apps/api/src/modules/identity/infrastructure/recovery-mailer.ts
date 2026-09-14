import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../../core/config/config.service.js';
import { MAILER, type Mailer } from '../../../core/mail/mailer.port.js';
import {
  emailVerificationEmail,
  passwordChangedEmail,
  passwordResetEmail,
} from '../../../core/mail/templates.js';
import {
  RecoveryTokenService,
  type RecoverySubject,
} from '../../../core/auth/recovery-tokens.js';

/** Where the links land. Must match the web app's routes. */
const VERIFY_PATH = '/verify-email';
const RESET_PATH = '/reset-password';
const FORGOT_PATH = '/forgot-password';

/**
 * Mints a recovery link and sends it.
 *
 * One place, because the three flows share the part that is easy to get
 * wrong: the token must be issued and delivered together, and a delivery
 * failure must not be reported to whoever triggered it.
 */
@Injectable()
export class RecoveryMailer {
  private readonly logger = new Logger(RecoveryMailer.name);

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly tokens: RecoveryTokenService,
    private readonly config: ConfigService,
  ) {}

  async sendEmailVerification(subject: RecoverySubject): Promise<void> {
    await this.attempt('email verification', subject.email, async () => {
      const ttl = this.config.core.AUTH_EMAIL_VERIFY_TTL_SECONDS;
      const token = await this.tokens.issue('email-verify', subject, ttl);

      await this.mailer.send({
        to: subject.email,
        ...emailVerificationEmail({
          link: this.link(VERIFY_PATH, token),
          expiresInSeconds: ttl,
          locale: subject.locale,
        }),
      });
    });
  }

  async sendPasswordReset(subject: RecoverySubject): Promise<void> {
    await this.attempt('password reset', subject.email, async () => {
      const ttl = this.config.core.AUTH_PASSWORD_RESET_TTL_SECONDS;
      const token = await this.tokens.issue('password-reset', subject, ttl);

      await this.mailer.send({
        to: subject.email,
        ...passwordResetEmail({
          link: this.link(RESET_PATH, token),
          expiresInSeconds: ttl,
          locale: subject.locale,
        }),
      });
    });
  }

  /**
   * The after-the-fact notice. Carries no token — it points at the public
   * forgot-password form, so the message is useful to the account owner and
   * worthless to anyone who intercepted it.
   */
  async sendPasswordChangedNotice(email: string, locale: string): Promise<void> {
    await this.attempt('password changed notice', email, async () => {
      await this.mailer.send({
        to: email,
        ...passwordChangedEmail({ link: this.link(FORGOT_PATH), locale }),
      });
    });
  }

  private link(path: string, token?: string): string {
    // Built from configuration, never from the request. A Host header an
    // attacker controls would otherwise decide where a reset link points.
    const url = new URL(path, this.config.core.APP_PUBLIC_URL);
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }

  /**
   * Runs the whole operation — mint, compose, deliver — and logs rather than
   * throws.
   *
   * The boundary is drawn around minting as well as sending, because the
   * callers differ in what they are doing but agree on what a failure means.
   * Registration must not fail because Redis hiccupped while issuing a
   * confirmation link; a forgot-password form must answer identically whether
   * or not the provider accepted the message, since anything else reports on
   * whether the address exists. Either way the user can ask for another link.
   */
  private async attempt(description: string, to: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.logger.error(
        `failed to send ${description} to ${to}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
