import { Injectable, Logger } from '@nestjs/common';
import type { Mailer, MailMessage } from './mailer.port.js';

/** How many recent messages stay readable. Enough for a test, not a mail store. */
const OUTBOX_LIMIT = 20;

/**
 * The development transport: prints the message and delivers nothing.
 *
 * This exists so the whole recovery flow can be built, tested and demonstrated
 * without an account at a mail provider — the link is right there in the
 * server log. It is refused in production by an env invariant, because a
 * password reset that silently never arrives is worse than one that errors.
 */
@Injectable()
export class LogMailer implements Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly messages: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    if (this.messages.length > OUTBOX_LIMIT) this.messages.shift();

    /*
     * Logged at `warn`, not `debug`.
     *
     * The default log level is `info`, so a debug line would be invisible
     * exactly when a developer is looking for the link — and the level is
     * honest besides: mail was requested and nothing was sent.
     */
    this.logger.warn(
      [
        'mail NOT SENT (transport=log)',
        `  to      : ${message.to}`,
        `  subject : ${message.subject}`,
        ...message.text.split('\n').map((line) => `  | ${line}`),
      ].join('\n'),
    );

    return Promise.resolve();
  }

  /** Recent messages, oldest first. For tests and local inspection only. */
  outbox(): readonly MailMessage[] {
    return [...this.messages];
  }
}
