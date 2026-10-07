import globals from 'globals';
import base from './eslint.base.config.mjs';

/** Root-level lint target: scripts, configs, CI helpers. */
export default [
  ...base,
  { ignores: ['apps/**', 'packages/**'] },
  {
    files: ['scripts/**/*.{js,mjs,cjs}', '*.mjs', '*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
    },
  },
];
