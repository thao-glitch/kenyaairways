import { defineConfig, devices } from '@playwright/test';

/**
 * E2E journey against a **running** stack — there is no `webServer` here on
 * purpose: CI brings up docker compose (API + web + seed) and locally you
 * point this at your dev servers:
 *
 *   WEB_URL=http://localhost:3000 API_URL=http://localhost:4000 \
 *   pnpm --filter @kenyaairways/web exec playwright test
 *
 * CI installs Playwright's chromium. Locally, set PLAYWRIGHT_CHROMIUM_PATH
 * to reuse a system browser (e.g. /usr/bin/chromium) instead of downloading.
 */
const baseURL = process.env.WEB_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
