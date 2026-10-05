import { defineConfig } from '@playwright/test';

const port = 8790;

/**
 * The browser tests in e2e/: they click through the web build in Chromium, at
 * phone size, against a pretend Supabase. See docs/TESTING.md.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    url: `http://localhost:${port}/login`,
    env: { PORT: String(port) },
    // Building takes a minute or two.
    timeout: 5 * 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
});
