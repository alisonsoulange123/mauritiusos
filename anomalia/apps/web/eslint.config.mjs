import base from '@anomalia/eslint-config';

export default [
  ...base,
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/app/*'],
              message: 'features/ must not import from app/. Composition flows app/ -> features/.',
            },
            {
              // Cross-feature imports are the frontend equivalent of a
              // cross-module import. Share through components/ui or shared/.
              group: ['@/features/*/ui/*', '@/features/*/model/*', '@/features/*/api/*'],
              message: 'Import another feature only through its index.ts, or lift the code to shared/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/features/*', '@/app/*'], message: 'UI primitives must stay business-agnostic.' }] },
      ],
    },
  },
];
