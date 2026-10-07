import globals from 'globals';
import base from '../../eslint.base.config.mjs';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
  },
];
