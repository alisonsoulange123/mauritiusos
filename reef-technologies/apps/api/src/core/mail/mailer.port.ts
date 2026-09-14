/**
 * The outbound mail port.
 *
 * Deliberately tiny, and deliberately a port. Account recovery is the first
 * thing that needs to send mail, but it will not be the last — document
 * expiry, advisor hand-offs and case updates all arrive here eventually — and
 * none of them should know which provider is behind it.
 *
 * Choosing a provider is therefore a one-file decision (`MAIL_TRANSPORT` plus
 * an adapter), not a refactor.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Always present. Some clients render nothing else, and some people prefer it. */
  text: string;
  html: string;
}

export interface Mailer {
  /**
   * Delivers the message, or throws.
   *
   * Throwing is correct here even though most callers swallow it: the port
   * reports what happened, and the use case decides what the user is told.
   * Recovery flows in particular must not leak delivery failures back to the
   * form, because "that address bounced" is an account-enumeration oracle.
   */
  send(message: MailMessage): Promise<void>;
}

export const MAILER = Symbol('MAILER');
