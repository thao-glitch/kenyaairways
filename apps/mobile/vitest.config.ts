import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirror tsconfig's `@/*` → `src/*` so spec files can import the same
    // paths the app code does.
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
