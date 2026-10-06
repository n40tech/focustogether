import type { Page } from '@playwright/test';

import type { FakeSupabase } from './fake-supabase';
import { button, expect, pathOf, test } from './test';

// You, signed in on two devices at once: the fake speaks for the other one.

/** As in src/world/gardenMap: you come in at the gate, and the shed door is bottom left. */
const GATE = { x: 540, y: 606 };
const SHED_DOOR = { x: 82, y: 602 };

test.beforeEach(({ fake }) => {
  fake.onBreak();
});

async function enterGarden(page: Page, fake: FakeSupabase) {
  await fake.open('/garden');
  await expect(page.getByPlaceholder('Say something…')).toBeVisible();
  // Listening to your other devices, and to Bob.
  await expect
    .poll(() => ['garden:nate', 'garden:bob'].every((t) => fake.joined.has(t)))
    .toBe(true);
}

const shed = (page: Page) => button(page, 'Go into the shed');

test("coming into the garden, you're where your other device has you", async ({ page, fake }) => {
  fake.elsewhere = SHED_DOOR;
  await enterGarden(page, fake);
  await expect(shed(page)).toBeVisible();
});

test('walking on your other device moves you here too', async ({ page, fake }) => {
  await enterGarden(page, fake);
  await expect(shed(page)).toBeHidden();
  fake.broadcastAs('nate', 'pos', { ...SHED_DOOR, walk: 1 });
  await expect(shed(page)).toBeVisible();
  // And what you say there shows here.
  fake.broadcastAs('nate', 'say', { text: 'back in a minute' });
  await expect(page.getByText('back in a minute')).toBeVisible();
});

test('walked two ways at once, a rift opens and you land in the car park', async ({
  page,
  fake,
}) => {
  await enterGarden(page, fake);
  await page.keyboard.down('ArrowRight');
  fake.broadcastAs('nate', 'pos', { x: GATE.x - 300, y: GATE.y - 40, walk: 1 });
  await expect(page.getByRole('img', { name: 'A rift' })).toBeVisible();
  await page.keyboard.up('ArrowRight');

  await expect(page.getByText(/a rift opened in the garden/)).toBeVisible();
  expect(pathOf(page)).toBe('/');
  // Still on your break.
  await expect(button(page, 'Garden')).toBeVisible();
});

test("only walking both at once does it: a device that's still just follows", async ({
  page,
  fake,
}) => {
  await enterGarden(page, fake);
  await page.keyboard.down('ArrowRight');
  // Your other device saying where it last had you (no one steering it).
  fake.broadcastAs('nate', 'pos', { x: GATE.x - 300, y: GATE.y - 40 });
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  await expect(page.getByRole('img', { name: 'A rift' })).toBeHidden();
  expect(pathOf(page)).toBe('/garden');
});

test("a friend's rift shows where it opened, then closes", async ({ page, fake }) => {
  await enterGarden(page, fake);
  fake.broadcastAs('bob', 'rift', { x: GATE.x, y: GATE.y - 60 });
  const rift = page.getByRole('img', { name: 'A rift' });
  await expect(rift).toBeVisible();
  await expect(rift).toBeHidden({ timeout: 8000 });
  expect(pathOf(page)).toBe('/garden');
});
