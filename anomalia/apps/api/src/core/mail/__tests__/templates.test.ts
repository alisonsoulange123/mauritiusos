import { describe, expect, it } from 'vitest';
import {
  emailVerificationEmail,
  passwordChangedEmail,
  passwordResetEmail,
  toMailLocale,
} from '../templates.js';

const LINK = 'https://anomalia.mu/reset-password?token=abc123';

describe('recovery email templates', () => {
  it('puts the link in the plain-text body, not only the button', () => {
    // A button is useless to a client that blocks HTML, and a visible URL is
    // what lets a cautious reader check where it goes before clicking.
    const message = passwordResetEmail({ link: LINK, expiresInSeconds: 3600, locale: 'en' });

    expect(message.text).toContain(LINK);
    expect(message.html).toContain(LINK);
  });

  it('states how long the link lasts, in the reader\'s language', () => {
    const english = passwordResetEmail({ link: LINK, expiresInSeconds: 3600, locale: 'en' });
    const french = passwordResetEmail({ link: LINK, expiresInSeconds: 3600, locale: 'fr' });

    expect(english.text).toContain('1 hour');
    expect(french.text).toContain('1 heure');
    expect(french.subject).toBe('Réinitialisez votre mot de passe');
  });

  it('rounds a day to hours rather than reporting 1440 minutes', () => {
    const message = emailVerificationEmail({
      link: LINK,
      expiresInSeconds: 60 * 60 * 24,
      locale: 'en',
    });

    expect(message.text).toContain('24 hours');
  });

  it('falls back to English for a locale it does not ship', () => {
    // Unrecognised must mean readable, never blank.
    expect(toMailLocale('de')).toBe('en');
    expect(toMailLocale('fr-MU')).toBe('fr');
    expect(toMailLocale('EN-gb')).toBe('en');
  });

  it('tells the reader that ignoring an unexpected reset is safe', () => {
    // The most common recipient of this message is someone who did not ask for
    // it. Frightening them into clicking is the opposite of the intent.
    const message = passwordResetEmail({ link: LINK, expiresInSeconds: 3600, locale: 'en' });

    expect(message.text).toContain('your password has not changed');
  });

  it('sends the after-the-fact notice without a token in it', () => {
    // The notice goes to an address that may have just been compromised. It
    // must be useful to the owner and worthless to anyone intercepting it.
    const message = passwordChangedEmail({
      link: 'https://anomalia.mu/forgot-password',
      locale: 'en',
    });

    expect(message.text).not.toContain('token=');
    expect(message.subject).toBe('Your password was changed');
  });

  it('escapes the link rather than interpolating it raw', () => {
    // The URL is built from configuration, but a template that trusts its
    // inputs is one refactor away from a template that should not have.
    const message = passwordResetEmail({
      link: 'https://x.test/r?token=a"><script>alert(1)</script>',
      expiresInSeconds: 60,
      locale: 'en',
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;');
  });
});
