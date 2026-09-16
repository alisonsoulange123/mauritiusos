import { describe, expect, it } from 'vitest';
import { DEFAULT_DESTINATION, safeRedirect } from '../safe-redirect';
import { isSameOrigin } from '../same-origin';

describe('safeRedirect', () => {
  it('keeps an in-site path', () => {
    expect(safeRedirect('/portal/assessment')).toBe('/portal/assessment');
    expect(safeRedirect('/portal?step=2')).toBe('/portal?step=2');
  });

  it('refuses to leave the site', () => {
    // Each of these has shipped as a real open redirect somewhere.
    for (const hostile of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'http://evil.example/portal',
      'javascript:alert(1)',
    ]) {
      expect(safeRedirect(hostile)).toBe(DEFAULT_DESTINATION);
    }
  });

  it('falls back when there is no target', () => {
    expect(safeRedirect(undefined)).toBe(DEFAULT_DESTINATION);
    expect(safeRedirect('')).toBe(DEFAULT_DESTINATION);
  });
});

describe('isSameOrigin', () => {
  it('accepts a matching origin, port included', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(isSameOrigin('https://app.reef-technologies.io', 'app.reef-technologies.io')).toBe(true);
  });

  it('rejects another origin', () => {
    expect(isSameOrigin('https://evil.example', 'app.reef-technologies.io')).toBe(false);
    // Same host, different port is a different origin — and on a dev machine
    // that is exactly where another app would be listening.
    expect(isSameOrigin('http://localhost:4000', 'localhost:3000')).toBe(false);
    // Prefix match is not a host match.
    expect(isSameOrigin('https://reef-technologies.io.evil.example', 'reef-technologies.io')).toBe(false);
  });

  it('rejects a missing or unparseable origin', () => {
    // A cross-site POST from a form element sends no Origin in some browsers,
    // and a sandboxed frame sends the literal string "null".
    expect(isSameOrigin(null, 'app.reef-technologies.io')).toBe(false);
    expect(isSameOrigin('null', 'app.reef-technologies.io')).toBe(false);
    expect(isSameOrigin('https://app.reef-technologies.io', null)).toBe(false);
  });
});
