import globals from 'globals';
import base from '../../eslint.base.config.mjs';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      // JSX is handled by the Next toolchain; react-specific rules land in M9
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
