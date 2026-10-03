import type { Page } from '@playwright/test';

import { button, expect, pathOf, test } from './test';

/** Hides or shows the page, as switching tabs or locking a phone does. */
async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((visible) => {
    const state = visible ? 'visible' : 'hidden';
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    Object.defineProperty(document, 'hidden', { value: !visible, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visible);
}

test('walking in hands you a desk, and a session can start', async ({ page, fake }) => {
  await fake.open('/');
  await button(page, 'Walk in').click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByText('You', { exact: true })).toBeVisible();
  expect(fake.called('set_place')).toContainEqual({ p_place: 'office' });

  await button(page, '50m').click();
  await expect(page.getByText('Earns about 50 chips and a 10 min break.')).toBeVisible();
  await button(page, 'Start 50 min').click();
  await expect(page.getByText('Studying · 50 min · stay on this page')).toBeVisible();
  const [started] = fake.called('start_session');
  expect(started.p_minutes).toBe(50);
  // This page's id: leaving this page stops the session.
  expect(started.p_device).toMatch(/^[a-z0-9]{10,}$/);
  // Chips are out of sight while you study.
  await expect(page.getByLabel('120 chips')).toHaveCount(0);
});

test('while you study, other places are out of reach', async ({ page, fake }) => {
  fake.studying(50);
  await fake.open('/garden');
  await expect(page.getByText('Studying · 50 min')).toBeVisible();
  expect(pathOf(page)).toBe('/office');

  await page.goto('/shop');
  await expect(page.getByText('Studying · 50 min')).toBeVisible();
  expect(pathOf(page)).toBe('/office');
});

test('giving up asks first, then frees you', async ({ page, fake }) => {
  fake.studying(50);
  await fake.open('/office');
  const asked: string[] = [];
  page.on('dialog', (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  await button(page, 'Give up').click();

  await expect(button(page, 'Start 25 min')).toBeVisible();
  expect(asked).toHaveLength(1);
  expect(fake.called('cancel_session')).toHaveLength(1);
});

test('walking out gets you up from your desk', async ({ page, fake }) => {
  fake.atDesk();
  await fake.open('/office');
  await button(page, 'Walk out').click();

  await expect(button(page, 'Walk in')).toBeVisible();
  expect(pathOf(page)).toBe('/');
  expect(fake.called('set_place')).toContainEqual({ p_place: 'outside' });
  expect(fake.me.place).toBe('outside');
});

test('a finished session pays out once, then you take a break', async ({ page, fake }) => {
  fake.onBreak();
  fake.payoutSeen = null;
  Object.assign(fake.me, { chips: 147, place: 'office' });
  await fake.open('/');

  await expect(page).toHaveURL(/\/payout$/);
  await expect(page.getByText('+27 chips')).toBeVisible();
  await expect(page.getByText('25 minutes studied · 2 lucky chips')).toBeVisible();
  // Still at your desk while the payout shows.
  expect(fake.called('set_place')).not.toContainEqual({ p_place: 'garden' });

  await button(page, 'Take a break').click();
  await expect(page).toHaveURL(/\/garden$/);
  await expect(page.getByPlaceholder('Say something…')).toBeVisible();
  await expect.poll(() => fake.called('set_place')).toContainEqual({ p_place: 'garden' });

  // Coming back doesn't show the same payout again.
  await page.goto('/');
  await expect(page.getByText(/You're on a break/)).toBeVisible();
  expect(pathOf(page)).toBe('/');
});

test('leaving the page stops a session, unless you come straight back', async ({ page, fake }) => {
  fake.atDesk();
  await fake.open('/office');
  await button(page, 'Start 25 min').click();
  const studying = page.getByText('Studying · 25 min · stay on this page');
  await expect(studying).toBeVisible();
  const session = fake.me.active_session!.id;

  // A quick look at another tab.
  await setVisible(page, false);
  await page.clock.fastForward(2000);
  await setVisible(page, true);
  await expect.poll(() => fake.called('back_to_page')).toHaveLength(1);
  const [left] = fake.called('leave_page');
  const [back] = fake.called('back_to_page');
  expect(left).toEqual({ p_session: session, p_device: expect.any(String) });
  expect(back).toMatchObject({ p_session: session, p_device: left.p_device });
  expect(back.p_away_s).toBeLessThanOrEqual(3);
  await expect(studying).toBeVisible();

  // Away for longer: the session stops, and the office says why.
  await setVisible(page, false);
  await page.clock.fastForward(40_000);
  await setVisible(page, true);
  await expect(
    page.getByText(/You left the page .* into your session, so it stopped/)
  ).toBeVisible();
  expect(fake.called('back_to_page')[1].p_away_s).toBeGreaterThanOrEqual(40);
  await expect(button(page, 'Start 25 min')).toBeVisible();

  // It still says so after a reload.
  await page.reload();
  await expect(page.getByText(/You left the page/)).toBeVisible();
});
