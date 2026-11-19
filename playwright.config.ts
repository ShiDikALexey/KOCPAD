import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests run against the Vite dev server on purpose: the dev build exposes
 * `window.__kocpad` for driving the editor where clicking is impractical, while
 * production output is covered by the regular build and typecheck jobs.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:1420',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 820 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 1420 --strictPort',
    url: 'http://localhost:1420',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
