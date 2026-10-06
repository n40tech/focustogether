import type { Page } from '@playwright/test';

import { INVITE, type FakeSupabase } from './fake-supabase';
import { button, expect, test } from './test';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';

/** Joins with an invite link, as a new player who's seen no tips. */
async function join(page: Page, fake: FakeSupabase) {
  fake.signedIn = false;
  Object.assign(fake.me, { sessions_done: 0, sessions_studied: 0, tips: [] });
  await fake.open(`/login?invite=${INVITE}`);
  await page.getByPlaceholder('Username (how friends find you)').fill('nate');
  await page.getByPlaceholder('Password').fill('hunter22');
  await button(page, 'Join').click();
  await expect(button(page, 'Walk in')).toBeVisible();
}

const welcome = (page: Page) => page.getByText(/Welcome to Focus Together/);

test.describe('on an iPhone', () => {
  test.use({ userAgent: IPHONE });

  test('after joining, it says how to add Focus Together to the home screen', async ({
    page,
    fake,
  }) => {
    await join(page, fake);
    const steps = page.getByText(/in Safari, tap ••• by the address bar/);
    await expect(steps).toBeVisible();
    await expect(welcome(page)).toBeHidden();

    await button(page, 'Got it: hide this tip').click();
    await expect(steps).toBeHidden();
    await expect(welcome(page)).toBeVisible();
    expect(fake.called('done_tip')).toEqual([{ p_tip: 'home_screen' }]);
  });
});

test.describe('on an Android phone', () => {
  test.use({ userAgent: ANDROID });

  test('after joining, it says how to add Focus Together in Chrome', async ({ page, fake }) => {
    await join(page, fake);
    await expect(page.getByText(/in Chrome, tap ⋮ at the top right/)).toBeVisible();
  });

  test("when Chrome offers to install it, that's one tap", async ({ page, fake }) => {
    await join(page, fake);
    await page.evaluate(() => {
      const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
        prompt: async () => {
          (window as { prompted?: boolean }).prompted = true;
        },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      });
      window.dispatchEvent(offer);
    });
    await button(page, 'Add').click();
    await expect(welcome(page)).toBeVisible();
    expect(await page.evaluate(() => (window as { prompted?: boolean }).prompted)).toBe(true);
    expect(fake.called('done_tip')).toEqual([{ p_tip: 'home_screen' }]);
  });
});

test('on a computer, joining goes straight to the welcome', async ({ page, fake }) => {
  await join(page, fake);
  await expect(welcome(page)).toBeVisible();
});
