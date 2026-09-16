import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser's path to the API must exist on disk.
 *
 * This guards a bug that survived a full rename, a green test suite and a
 * manual smoke test. The constant said `/api/reef_technologies` while the
 * route directory was `reef-technologies`, so every call made from the browser
 * hit Next's own 404 page — whose body is not the API error envelope, so the
 * UI reported "the API returned 404 with an unrecognized body" and named
 * nothing useful.
 *
 * Nothing else caught it: server-rendered pages call the API directly and were
 * fine, and the integration suite drives the API rather than a browser. The
 * only thing the two sides share is this string and that folder, so that is
 * what this asserts.
 */
describe('the browser proxy route', () => {
  const clientSource = readFileSync(resolve(__dirname, '..', 'client.ts'), 'utf8');
  const configured = /const BROWSER_PROXY = '([^']+)'/.exec(clientSource)?.[1];

  it('is declared', () => {
    expect(configured).toBeDefined();
  });

  it('points at a route that exists', () => {
    // `/api/x` -> `src/app/api/x/[...path]/route.ts`
    const segment = (configured as string).replace(/^\/api\//, '');
    const route = resolve(
      __dirname,
      '..',
      '..',
      '..',
      'app',
      'api',
      segment,
      '[...path]',
      'route.ts',
    );

    expect(existsSync(route), `no proxy route for "${configured}" (looked for ${route})`).toBe(
      true,
    );
  });
});
