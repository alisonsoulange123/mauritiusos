/**
 * Architectural boundary rules — the lint-level half of "low coupling".
 *
 * The rules below are what makes modular isolation a *build failure* rather
 * than a code-review convention. Three invariants:
 *
 *  1. A module may never reach into another module's internals. The only
 *     legal cross-module surface is `@reef-technologies/contracts`.
 *  2. `core/` may never import from `modules/`. Core does not know its
 *     tenants; the registry inverts that dependency.
 *  3. The domain layer may never import infrastructure or the framework.
 *     (Hexagonal: domain defines ports, infrastructure implements them.)
 */
export const backendBoundaries = {
  files: ['src/modules/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/modules/*/**', '@modules/*/*'],
            message:
              'Cross-module deep imports are forbidden. Communicate via the EventBus or a ContractToken from @reef-technologies/contracts.',
          },
        ],
      },
    ],
  },
};

export const coreBoundaries = {
  files: ['src/core/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['**/modules/**', '@modules/*'],
            message:
              'core/ must not depend on modules/. Modules register themselves into core; never the reverse.',
          },
        ],
      },
    ],
  },
};

export const domainPurity = {
  files: ['src/modules/*/domain/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { group: ['@nestjs/*'], message: 'The domain layer must stay framework-agnostic.' },
          { group: ['drizzle-orm*', 'pg', 'ioredis'], message: 'The domain layer must not know about persistence. Define a port instead.' },
          { group: ['../infrastructure/*', '../interface/*'], message: 'Dependencies point inward: domain <- application <- infrastructure.' },
        ],
      },
    ],
  },
};
