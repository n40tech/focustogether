import type { Locator, Page } from '@playwright/test';

import { ALL_TIPS, iso } from './fake-supabase';
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
  await expect(page.getByText('Studying · 50 min · keep this tab open')).toBeVisible();
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

test.describe('on a phone', () => {
  // A touchscreen, so the page knows it's on a phone.
  test.use({ hasTouch: true });

  test('leaving the page stops a session, unless you come straight back', async ({
    page,
    fake,
  }) => {
    fake.atDesk();
    fake.me.tips = ALL_TIPS.filter((tip) => tip !== 'stay');
    await fake.open('/office');
    await button(page, 'Start 25 min').click();
    const studying = page.getByText('Studying · 25 min · stay on this page');
    await expect(studying).toBeVisible();
    await expect(page.getByText(/Switch apps or tabs, or lock your phone/)).toBeVisible();
    const session = fake.me.active_session!.id;

    // A quick look at another app.
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
});

test('on a computer, other tabs are fine, but leaving the page stops a session', async ({
  page,
  fake,
}) => {
  fake.atDesk();
  fake.me.tips = ALL_TIPS.filter((tip) => tip !== 'stay');
  await fake.open('/office');
  await button(page, 'Start 25 min').click();
  const studying = page.getByText('Studying · 25 min · keep this tab open');
  await expect(studying).toBeVisible();
  await expect(page.getByText(/Other tabs and windows are fine/)).toBeVisible();
  const session = fake.me.active_session!.id;

  // Lecture notes in another tab, for five minutes. Back on the page, it
  // checks in as usual, and has said nothing about leaving.
  const checkIns = fake.called('get_me').length;
  await setVisible(page, false);
  await page.clock.fastForward(5 * 60_000);
  await setVisible(page, true);
  await expect.poll(() => fake.called('get_me').length).toBeGreaterThan(checkIns);
  expect(fake.called('leave_page')).toEqual([]);
  expect(fake.called('back_to_page')).toEqual([]);
  await expect(studying).toBeVisible();

  // A reload leaves the page, but it's back in time, so the session carries on.
  // (Word that it left goes as the page unloads, out of the fake's sight, so
  // this checks the page saying how long it was away.)
  await page.reload();
  await expect(studying).toBeVisible();
  await expect.poll(() => fake.called('back_to_page')).toHaveLength(1);
  const [back] = fake.called('back_to_page');
  expect(back).toMatchObject({ p_session: session, p_device: expect.any(String) });
  expect(back.p_away_s).toBeLessThanOrEqual(3);

  // Off to another site in this tab, and back 40 seconds later: it stopped.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect
    .poll(() => fake.called('leave_page'))
    .toEqual([{ p_session: session, p_device: back.p_device }]);
  await page.clock.fastForward(40_000);
  await setVisible(page, true);
  await expect(
    page.getByText(/You left the page .* into your session, so it stopped/)
  ).toBeVisible();
  expect(fake.called('back_to_page')[1].p_away_s).toBeGreaterThanOrEqual(40);
});

test('joining a friend: your session ends when theirs does', async ({ page, fake }) => {
  fake.atDesk();
  Object.assign(fake.friends[0], {
    status: 'focused',
    ends_at: iso(20),
    break_ends_at: null,
    place: 'office',
  });
  await fake.open('/office');
  await button(page, "Bob's desk").click();
  await expect(page.getByText('Studying: 20m left.')).toBeVisible();

  await button(page, 'Join Bob').click();
  await expect(page.getByText(/^Studying · 20 min/)).toBeVisible();
  const [joined] = fake.called('join_session');
  expect(joined.p_username).toBe('bob');
  expect(joined.p_device).toMatch(/^[a-z0-9]{10,}$/);
  expect(fake.me.active_session?.ends_at).toBe(fake.friends[0].ends_at);
});

test('a friend of a friend sits greyed out, and you can ask them to be friends', async ({
  page,
  fake,
}) => {
  fake.atDesk();
  fake.friendsOfFriends = [
    {
      username: 'dave',
      display_name: 'Dave',
      status: 'focused',
      place: 'office',
      arrived_at: iso(-10),
      vehicle: 'hatchback',
      desk_items: [{ item: 'duck', x: 36, y: -26 }],
      desk: 2,
      via: ['Bob'],
    },
  ];
  await fake.open('/office');
  await button(page, "Dave's desk").click();
  await expect(page.getByText('@dave · friends with Bob')).toBeVisible();
  await button(page, 'Ask to be friends').click();
  await expect(
    page.getByText('Asked. Dave will be on your Friends board once they say yes.')
  ).toBeVisible();
  expect(fake.called('add_friend')).toEqual([{ p_username: 'dave' }]);
});

test('moving to an empty desk, between sessions', async ({ page, fake }) => {
  fake.atDesk();
  await fake.open('/office');
  await button(page, 'Empty desk 6').click();
  await button(page, 'Sit here').click();
  await expect(button(page, 'Sit here')).toBeHidden();
  expect(fake.called('switch_desk')).toEqual([{ p_desk: 5 }]);
  expect(fake.me.desk).toBe(5);
});

test("while you study, empty desks can't be taken", async ({ page, fake }) => {
  fake.studying(50);
  await fake.open('/office');
  await expect(page.getByText('Studying · 50 min')).toBeVisible();
  await expect(button(page, 'Empty desk 6')).toHaveCount(0);
});

test('arranging your desk by dragging things about', async ({ page, fake }) => {
  fake.atDesk();
  fake.me.tips = fake.me.tips.filter((t) => t !== 'arrange');
  fake.me.inventory = { ...fake.me.inventory, mug: 1, duck: 1 };
  fake.me.desk_items = [
    { item: 'duck', x: 36, y: -26 },
    { item: 'mug', x: -36, y: -24 },
  ];
  await fake.open('/office');
  await button(page, 'Arrange your desk').click();
  await expect(
    page.getByText(/^Drag things from the top onto your desk, and drag them/)
  ).toBeVisible();
  const drag = dragOn(page, page.getByLabel('Your desk', { exact: true }));

  // The duck, up to the top: back in the drawer.
  await drag([36, -31], [36, -90]);
  await expect.poll(() => fake.called('store_desk_item')).toEqual([{ p_item: 'duck' }]);

  // The mug, across the desk.
  await drag([-36, -29], [21, -33]);
  await expect
    .poll(() => fake.called('place_desk_item'))
    .toEqual([{ p_item: 'mug', p_x: 21, p_y: -28 }]);

  // The duck again, from the top (first in the drawer) onto the desk.
  await drag([-42, -89], [0, -25]);
  await expect.poll(() => fake.me.desk_items).toContainEqual({ item: 'duck', x: 0, y: -20 });
});

test('something new for your desk goes on it straight from the shed', async ({ page, fake }) => {
  fake.shop.push({
    slug: 'mug',
    kind: 'desk',
    name: 'Mug',
    price: 10,
    pack_size: 1,
    owned: 0,
    grow_hours: null,
    yield: null,
  });
  await fake.open('/shop?from=garden');
  await button(page, 'Buy Mug for 10 chips').click();
  await expect(page.getByText('Your new mug is at the top. Drag it onto your desk.')).toBeVisible();
  await dragOn(page, page.getByLabel('Your desk', { exact: true }))([-42, -89], [10, -30]);
  await expect.poll(() => fake.me.desk_items).toEqual([{ item: 'mug', x: 10, y: -25 }]);
});

/**
 * Drags on the desk close-up from one point to another, in desk units (as in
 * src/components/ArrangeSheet: S = 2.4, front-centre at (130, 234)).
 */
function dragOn(page: Page, stage: Locator) {
  return async (from: [number, number], to: [number, number]) => {
    const box = (await stage.boundingBox())!;
    const px = ([x, y]: [number, number]) => [box.x + 130 + x * 2.4, box.y + 234 + y * 2.4];
    const [x0, y0] = px(from);
    const [x1, y1] = px(to);
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 10 });
    await page.mouse.up();
  };
}
