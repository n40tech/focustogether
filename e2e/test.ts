import { test as base, expect, type Locator, type Page } from '@playwright/test';

import { FakeSupabase } from './fake-supabase';

/**
 * Every test gets a page with a pretend Supabase behind it (`fake`), and a
 * clock it can move on (`page.clock`). A test fails if the page throws an
 * error, or calls something the fake has no answer for.
 */
export const test = base.extend<{ fake: FakeSupabase }>({
  fake: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    const fake = new FakeSupabase(page);
    await fake.install();
    await use(fake);
    expect(errors, 'errors thrown on the page').toEqual([]);
    expect(fake.unknown, 'calls the fake Supabase has no answer for').toEqual([]);
  },
});

export { expect };

/** A button, by its exact name. */
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** The path of the page's address: '/', '/office' and so on. */
export const pathOf = (page: Page) => new URL(page.url()).pathname;

type Arrow = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * Walks round the garden with an arrow key held down for `ms`, or until
 * `until` shows up. The page's clock stands still meanwhile and is moved on in
 * small steps, so a walk goes the same distance however busy the computer is.
 */
export async function walk(page: Page, key: Arrow, ms: number, until?: Locator) {
  // The page's clock is still running as this goes over, so stop it a moment ahead.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await page.keyboard.down(key);
  try {
    for (let walked = 0; walked < ms; walked += 50) {
      await page.clock.runFor(50);
      if (until && (await until.isVisible())) return;
    }
    if (until) throw new Error(`Walked ${key} for ${ms} ms, and ${until} never showed up`);
  } finally {
    await page.keyboard.up(key);
    await page.clock.resume();
  }
}
