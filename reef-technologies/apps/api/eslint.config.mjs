import base from '@reef-technologies/eslint-config';
import { backendBoundaries, coreBoundaries, domainPurity } from '@reef-technologies/eslint-config/boundaries';

export default [
  ...base,
  coreBoundaries,
  backendBoundaries,
  domainPurity,
  {
    files: ['src/**/*.ts'],
    rules: {
      /**
       * OFF, deliberately — and do not turn it back on.
       *
       * NestJS resolves constructor dependencies from `design:paramtypes`
       * metadata that TypeScript emits only for VALUE imports. Rewriting an
       * injected class to `import type` erases that metadata, and the result
       * is not a compile error: the app builds, then fails at runtime with
       * "Nest can't resolve dependencies". `--fix` applies that rewrite across
       * the whole codebase in one go, so the rule is actively dangerous here.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
