import globals from 'globals';
import base from '../../eslint.base.config.mjs';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
