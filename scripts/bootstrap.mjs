#!/usr/bin/env node
/**
 * Bootstrap: create `.env` from `.env.example` (if missing) and replace the
 * __GENERATE__ / __GENERATE_32B__ placeholders with locally generated random
 * secrets. Never overwrites an existing `.env`.
 *
 * Also links apps/api/.env to the root file, because the Prisma CLI resolves
 * `.env` from the app directory.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const examplePath = join(root, '.env.example');
const envPath = join(root, '.env');
const apiEnvPath = join(root, 'apps', 'api', '.env');

if (!existsSync(examplePath)) {
  console.error('✗ .env.example not found');
  process.exit(1);
}

const secret = (bytes = 32) => randomBytes(bytes).toString('hex');
const base64Key = () => randomBytes(32).toString('base64');

if (existsSync(envPath)) {
  console.log('• .env already exists — leaving it untouched');
} else {
  const contents = readFileSync(examplePath, 'utf8')
    .replaceAll('__GENERATE_32B__', base64Key())
    .replaceAll('__GENERATE__', () => secret(32));
  writeFileSync(envPath, contents, { mode: 0o600 });
  console.log('✓ created .env with generated secrets (git-ignored)');
}

if (!existsSync(apiEnvPath)) {
  try {
    symlinkSync(join(root, '.env'), apiEnvPath);
    console.log('✓ linked apps/api/.env -> .env (for the Prisma CLI)');
  } catch {
    copyFileSync(envPath, apiEnvPath);
    console.log('✓ copied .env to apps/api/.env (symlink unsupported here)');
  }
}

console.log('  next: pnpm install && pnpm db:migrate && pnpm db:seed');
