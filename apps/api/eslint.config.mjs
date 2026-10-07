import globals from 'globals';
import base from '../../eslint.base.config.mjs';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      // NestJS injects constructor params from `design:paramtypes` emitted by
      // swc/TS. Classes used as tokens must be value imports, otherwise the
      // metadata degrades to `Object` and DI fails at runtime.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  {
    files: ['prisma/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Seeds and fixtures legitimately construct partial records
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
