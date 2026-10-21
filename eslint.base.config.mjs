import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared ESLint base for every workspace package.
 * Package-level `eslint.config.mjs` files spread this array and add local rules.
 */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-implicit-coercion': 'off',
    },
  },
  prettier,
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/out/**',
      '**/android/**',
      '**/ios/**',
      '**/.expo/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
];
