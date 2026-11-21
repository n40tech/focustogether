/// <reference types="node" />
import path from 'node:path';

import { defineConfig } from '@playwright/test';

import base from '../playwright.config';

/**
 * Takes the website's pictures of the game (scripts/site-shots.spec.ts), with
 * the browser tests' build and pretend Supabase. Not part of the test run.
 *
 *   npm run site:shots
 */
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: 'site-shots.spec.ts',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 120_000,
  // Built and served from the repo, as for the tests.
  webServer: {
    ...(base.webServer as object),
    cwd: path.join(__dirname, '..'),
  } as typeof base.webServer,
});
