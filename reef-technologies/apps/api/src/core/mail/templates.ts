import type { MailMessage } from './mailer.port.js';

/**
 * Recovery email copy, in the languages the platform actually ships.
 *
 * Pure functions returning a message body — no transport, no config, no I/O —
 * so the wording and the link construction can be asserted in a unit test
 * rather than read out of a log.
 */

export type MailLocale = 'en' | 'fr';

/** Anything unrecognised falls back to English rather than rendering blanks. */
export const toMailLocale = (locale: string): MailLocale =>
  locale.toLowerCase().startsWith('fr') ? 'fr' : 'en';

export type MailBody = Omit<MailMessage, 'to'>;

export interface RecoveryMailInput {
  link: string;
  expiresInSeconds: number;
  locale: string;
}

export function emailVerificationEmail(input: RecoveryMailInput): MailBody {
  const locale = toMailLocale(input.locale);
  const validity = humanDuration(input.expiresInSeconds, locale);

  const copy = {
    en: {
      subject: 'Confirm your email address',
      heading: 'Confirm your email address',
      lead: 'Confirm the address you used to create your Reef Technologies account.',
      action: 'Confirm email',
      note: `This link is valid for ${validity}. If you did not create an account, ignore this message.`,
    },
    fr: {
      subject: 'Confirmez votre adresse e-mail',
      heading: 'Confirmez votre adresse e-mail',
      lead: "Confirmez l'adresse utilisée pour créer votre compte Reef Technologies.",
      action: "Confirmer l'adresse",
      note: `Ce lien est valable ${validity}. Si vous n'avez pas créé de compte, ignorez ce message.`,
    },
  }[locale];

  return compose(copy, input.link);
}

export function passwordResetEmail(input: RecoveryMailInput): MailBody {
  const locale = toMailLocale(input.locale);
  const validity = humanDuration(input.expiresInSeconds, locale);

  const copy = {
    en: {
      subject: 'Reset your password',
      heading: 'Reset your password',
      lead: 'Someone asked to reset the password on your Reef Technologies account.',
      action: 'Choose a new password',
      // The reassurance matters: the most common recipient of this message is
      // someone who did not ask for it, and they need to know that ignoring
      // it is safe rather than being frightened into clicking.
      note: `This link is valid for ${validity} and can be used once. If this was not you, ignore this message — your password has not changed.`,
    },
    fr: {
      subject: 'Réinitialisez votre mot de passe',
      heading: 'Réinitialisez votre mot de passe',
      lead: "Une réinitialisation du mot de passe de votre compte Reef Technologies a été demandée.",
      action: 'Choisir un nouveau mot de passe',
      note: `Ce lien est valable ${validity} et ne peut servir qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe n'a pas changé.`,
    },
  }[locale];

  return compose(copy, input.link);
}

/**
 * Sent after the fact, to the address that just had its password changed.
 *
 * This is the message that catches a takeover. A reset flow tells the attacker
 * they succeeded; only this tells the owner, and it is the reason the whole
 * flow is worth building carefully.
 */
export function passwordChangedEmail(input: { link: string; locale: string }): MailBody {
  const locale = toMailLocale(input.locale);

  const copy = {
    en: {
      subject: 'Your password was changed',
      heading: 'Your password was changed',
      lead: 'The password on your Reef Technologies account was changed, and every signed-in device was signed out.',
      action: 'Secure your account',
      note: 'If you did not do this, reset your password now and contact us.',
    },
    fr: {
      subject: 'Votre mot de passe a été modifié',
      heading: 'Votre mot de passe a été modifié',
      lead: "Le mot de passe de votre compte Reef Technologies a été modifié et tous les appareils connectés ont été déconnectés.",
      action: 'Sécuriser mon compte',
      note: "Si vous n'êtes pas à l'origine de ce changement, réinitialisez votre mot de passe immédiatement et contactez-nous.",
    },
  }[locale];

  return compose(copy, input.link);
}

interface Copy {
  subject: string;
  heading: string;
  lead: string;
  action: string;
  note: string;
}

function compose(copy: Copy, link: string): MailBody {
  return {
    subject: copy.subject,
    // The URL is repeated as plain text because a button is useless to anyone
    // whose client blocks HTML, and because a visible URL is what lets a
    // cautious reader check where it goes before clicking.
    text: `${copy.heading}\n\n${copy.lead}\n\n${copy.action}:\n${link}\n\n${copy.note}\n`,
    html: layout(copy, link),
  };
}

/**
 * Inline styles only, and a table-free single column.
 *
 * Mail clients strip <style> blocks and disagree about everything else, so the
 * safe subset is small. This is not a design system; it is the most that
 * renders identically in Gmail, Outlook and Apple Mail.
 */
function layout(copy: Copy, link: string): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#faf9f7;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
  <div style="max-width:480px;margin:0 auto">
    <p style="margin:0 0 32px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#6b6b6b">Reef Technologies</p>
    <h1 style="margin:0 0 16px;font-size:22px;font-weight:500;line-height:1.3">${escapeHtml(copy.heading)}</h1>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6">${escapeHtml(copy.lead)}</p>
    <p style="margin:0 0 24px">
      <a href="${href}" style="display:inline-block;padding:12px 20px;background:#1a1a1a;color:#faf9f7;text-decoration:none;border-radius:8px;font-size:14px">${escapeHtml(copy.action)}</a>
    </p>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#6b6b6b;word-break:break-all">${href}</p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b6b">${escapeHtml(copy.note)}</p>
  </div>
</body></html>`;
}

/** Rounds to whole hours once past an hour; nobody wants "1440 minutes". */
function humanDuration(seconds: number, locale: MailLocale): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  // "minutes" happens to be the same word in both languages, and the singular
  // never occurs: the shortest window the platform issues is measured in tens.
  if (minutes < 60) return `${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  if (locale === 'fr') return hours === 1 ? '1 heure' : `${hours} heures`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
