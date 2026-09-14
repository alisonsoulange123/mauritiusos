import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { Mailer, MailMessage } from './mailer.port.js';

/** A provider that has not answered in ten seconds is not going to. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Delivery over a JSON HTTP API.
 *
 * The body is `{ from, to, subject, html, text }` with a bearer token, which
 * is what the mainstream transactional providers accept as-is and what any
 * in-house relay can be made to accept in an afternoon. That keeps the vendor
 * decision in `.env` rather than in the dependency tree — there is no SDK
 * here, only `fetch`.
 *
 * A provider needing a different body shape gets its own adapter next to this
 * one and a new `MAIL_TRANSPORT` value. That is the whole point of the port.
 */
@Injectable()
export class HttpMailer implements Mailer {
  private readonly logger = new Logger('Mailer');

  constructor(private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const { MAIL_HTTP_ENDPOINT, MAIL_HTTP_TOKEN, MAIL_FROM } = this.config.core;

    // Guaranteed by the env schema; asserted here so a future caller that
    // constructs this class directly fails loudly instead of posting to
    // `undefined`.
    if (!MAIL_HTTP_ENDPOINT || !MAIL_HTTP_TOKEN) {
      throw new Error('HttpMailer requires MAIL_HTTP_ENDPOINT and MAIL_HTTP_TOKEN');
    }

    const response = await fetch(MAIL_HTTP_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${MAIL_HTTP_TOKEN}`,
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      // The body usually names the reason (unverified sender, bad token). It
      // is truncated because provider errors can be long, and it is logged
      // rather than returned: the caller must not surface it to the user.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      this.logger.error(`mail provider rejected the message: ${response.status} ${detail}`);
      throw new Error(`mail transport returned ${response.status}`);
    }
  }
}
