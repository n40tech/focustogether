import type { Page } from '@playwright/test';

import { iso, withered, type FakeSupabase } from './fake-supabase';
import { button, expect, pathOf, test, walk } from './test';

// You come in through the gate, at the bottom of the garden, in the middle.

test.beforeEach(({ fake }) => {
  fake.onBreak();
});

async function enterGarden(page: Page, fake: FakeSupabase) {
  await fake.open('/garden');
  await expect(page.getByPlaceholder('Say something…')).toBeVisible();
}

test("buying from a friend's stall", async ({ page, fake }) => {
  // Bob's just inside the gate.
  fake.inGarden = [{ username: 'bob', x: 578, y: 600 }];
  await enterGarden(page, fake);
  await button(page, "Bob's stall").click();
  await expect(page.getByText('5 strawberries')).toBeVisible();
  await button(page, 'Buy 1 · 3').click();

  await expect(page.getByText('4 strawberries')).toBeVisible();
  expect(fake.called('buy_listing')).toEqual([{ p_id: 11, p_qty: 1 }]);
});

test('putting something out on your stall', async ({ page, fake }) => {
  await enterGarden(page, fake);
  await button(page, 'Your market stall').click();
  await button(page, 'Tomato (3)').click();
  await button(page, '5').click();
  await button(page, 'Put out 1 tomato').click();

  await expect(page.getByText('5 each')).toBeVisible();
  expect(fake.called('list_item')).toEqual([{ p_item: 'tomato', p_qty: 1, p_price: 5 }]);
});

test('clearing a withered bed and planting it', async ({ page, fake }) => {
  // Both beds at the front of your plot have a withered radish in.
  fake.plots = [withered(2, 0), withered(3, 0)];
  await enterGarden(page, fake);
  const clear = button(page, 'Clear the withered plant');
  await walk(page, 'ArrowRight', 400);
  await walk(page, 'ArrowUp', 4000, clear);
  await clear.click();
  await button(page, 'Plant something').click();
  await expect(page.getByText('Plant · room for 4')).toBeVisible();
  await button(page, 'Plant 2').click();

  await expect.poll(() => fake.called('plant')).toHaveLength(2);
  const [{ p_bed: bed }] = fake.called('clear_bed');
  expect([2, 3]).toContain(bed);
  expect(fake.called('plant')).toEqual([
    { p_bed: bed, p_seed: 'tomato_seeds' },
    { p_bed: bed, p_seed: 'tomato_seeds' },
  ]);
  // One seed, one plant, side by side.
  expect(fake.plots.filter((p) => p.bed === bed).map((p) => p.spot)).toEqual([0, 1]);
  await button(page, 'Close').last().click();
  await expect(button(page, 'Plant more')).toBeVisible();
  // Friends saw you walk up.
  expect(fake.broadcasts).toBeGreaterThan(3);
});

test('saying something, and eating a tomato', async ({ page, fake }) => {
  fake.me.inventory = { tomato: 2 };
  await enterGarden(page, fake);
  await page.getByPlaceholder('Say something…').fill('anyone want a tomato?');
  await button(page, 'Say').click();
  await expect(page.getByText('anyone want a tomato?')).toBeVisible();

  await button(page, 'Your basket').click();
  await expect(page.getByText('2 tomatoes')).toBeVisible();
  await button(page, 'Eat').first().click();
  await expect(page.getByText('1 tomato', { exact: true })).toBeVisible();
  expect(fake.called('eat')).toEqual([{ p_item: 'tomato' }]);
});

test('the shed sells a bike, and leads back to the garden', async ({ page, fake }) => {
  await fake.open('/shop?from=garden');
  await button(page, 'Buy Bicycle for 60 chips').click();
  await expect(page.getByText('Yours')).toBeVisible();
  expect(fake.called('buy')).toEqual([{ p_item: 'bike' }]);

  await button(page, 'Back to the garden').click();
  await expect(page).toHaveURL(/\/garden$/);
});

test('the post box: picking up a letter, and writing back', async ({ page, fake }) => {
  fake.letters = [
    {
      id: 81,
      from: 'bob',
      from_name: 'Bob',
      body: 'Tomatoes look great this year.',
      sent_at: iso(-90),
      read_at: null,
    },
  ];
  await enterGarden(page, fake);
  // Up past the bench, then along to the post box, bottom right.
  const postBox = button(page, 'Post box · 1 for you');
  await walk(page, 'ArrowUp', 300);
  await walk(page, 'ArrowRight', 6000, postBox);
  await postBox.click();

  await expect(page.getByText('Tomatoes look great this year.')).toBeVisible();
  await expect(page.getByText(/From Bob · .* · new/)).toBeVisible();
  expect(fake.called('pick_up_post')).toHaveLength(1);

  await button(page, 'Write a letter').last().click();
  await page.getByPlaceholder('Dear Bob,').fill('Thanks! Want some?');
  await button(page, 'Post it to Bob').click();
  await expect(page.getByText(/waiting for Bob in the post box/)).toBeVisible();
  expect(fake.called('send_letter')).toEqual([{ p_to: 'bob', p_body: 'Thanks! Want some?' }]);
});

test("a friend by the post box doesn't hide it", async ({ page, fake }) => {
  fake.letters = [
    { id: 82, from: 'bob', from_name: 'Bob', body: 'Over here!', sent_at: iso(-5), read_at: null },
  ];
  // Bob's standing by the post box, bottom right.
  fake.inGarden = [{ username: 'bob', x: 1000, y: 600 }];
  await enterGarden(page, fake);
  const postBox = button(page, 'Post box · 1 for you');
  await walk(page, 'ArrowUp', 300);
  await walk(page, 'ArrowRight', 6000, postBox);
  // Bob as well, beside it, by name.
  await expect(button(page, "Bob's stall")).toHaveText('Bob');

  await postBox.click();
  await expect(page.getByText('Over here!')).toBeVisible();
});

test('sitting on a bench, and getting up by walking off', async ({ page, fake }) => {
  await enterGarden(page, fake);
  const sit = button(page, 'Sit on the bench');
  await walk(page, 'ArrowUp', 300);
  await walk(page, 'ArrowRight', 4000, sit);
  await sit.click();
  const standUp = button(page, 'Stand up');
  await expect(standUp).toBeVisible();

  const sent = fake.broadcasts;
  await walk(page, 'ArrowLeft', 300);
  await expect(standUp).toBeHidden();
  // Friends saw you get up.
  expect(fake.broadcasts).toBeGreaterThan(sent);
});

test('throwing something in the bins', async ({ page, fake }) => {
  fake.me.inventory = { carrot: 2 };
  await enterGarden(page, fake);
  // Up past the bench, then along to the bin by the shed.
  const bins = button(page, 'Throw something away');
  await walk(page, 'ArrowUp', 300);
  await walk(page, 'ArrowLeft', 6000, bins);
  await bins.click();
  await expect(page.getByText('2 carrots')).toBeVisible();
  await button(page, 'Bin 1').click();

  await expect(page.getByText('1 carrot', { exact: true })).toBeVisible();
  expect(fake.called('bin_item')).toEqual([{ p_item: 'carrot', p_qty: 1 }]);
});

test('walking out through the gate goes back to work', async ({ page, fake }) => {
  await enterGarden(page, fake);
  await walk(page, 'ArrowDown', 800);
  await expect(page).toHaveURL(/\/office$/);
  await expect.poll(() => fake.called('set_place')).toContainEqual({ p_place: 'office' });
});

test('going home ends the break', async ({ page, fake }) => {
  await enterGarden(page, fake);
  await button(page, 'Go home').click();

  await expect(button(page, 'Walk in')).toBeVisible();
  expect(pathOf(page)).toBe('/');
  expect(fake.called('go_home')).toHaveLength(1);
  expect(fake.me.status).toBe('absent');
});

test('choosing your look', async ({ page, fake }) => {
  await enterGarden(page, fake);
  await button(page, 'Your look').click();
  await button(page, 'Skin: Olive').click();
  await button(page, 'Favourite colour: Teal').click();
  await button(page, 'Hairstyle: Curly').click();
  await button(page, 'Hair colour: Grey').click();
  await button(page, 'Save my look').click();

  await expect(button(page, 'Save my look')).toBeHidden();
  expect(fake.called('set_looks')).toEqual([
    { p_looks: { skin: 4, colour: 5, hair: 'curly', hair_colour: 5 } },
  ]);
});

test("a friend of a friend walks about, see-through, as Bob's friend until you tap them", async ({
  page,
  fake,
}) => {
  fake.friendsOfFriends = [
    {
      username: 'dave',
      display_name: 'Dave',
      status: 'on_break',
      place: 'garden',
      arrived_at: iso(-10),
      vehicle: null,
      vehicle_health: 100,
      parked: null,
      desk_items: [],
      desk: 2,
      via: ['Bob'],
    },
  ];
  // Dave's just inside the gate.
  fake.inGarden = [{ username: 'dave', x: 578, y: 600 }];
  await enterGarden(page, fake);
  await button(page, "Bob's friend").click();
  await expect(page.getByText('1 friend in common: Bob')).toBeVisible();
  await button(page, 'Ask to be friends').click();
  await button(page, 'Close').last().click();
  await expect(button(page, 'Dave')).toBeVisible();

  // You see where they are, but not what they say.
  expect([...fake.joined]).toContain('garden:dave');
  expect([...fake.joined]).not.toContain('garden-chat:dave');
  expect([...fake.joined]).toContain('garden-chat:bob');
});

test('under-18s have nothing to smoke in the garden', async ({ page, fake }) => {
  fake.me.under_18 = true;
  await enterGarden(page, fake);
  await expect(button(page, 'Your basket')).toBeVisible();
  await expect(page.getByRole('button', { name: /Smoke a cigarette/ })).toHaveCount(0);
});
