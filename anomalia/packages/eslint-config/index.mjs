import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/** Baseline shared by every workspace package. */
export const base = [
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      complexity: ['warn', 12],
      'max-depth': ['warn', 4],
    },
  },
  { ignores: ['dist/**', '.next/**', 'node_modules/**', 'coverage/**', '**/generated/**'] },
];

export default base;
