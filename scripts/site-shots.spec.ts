/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { iso, type FakeSupabase } from '../e2e/fake-supabase';
import { test } from '../e2e/test';
import type { DeskThing, Friend, Garden, Listing, Plot } from '@/lib/api';
import type { Looks } from '@/lib/looks';

/**
 * The website's pictures of the game (site/): the car park, the office (and
 * the office with you at each free desk) and the garden, full of friends, at
 * a widescreen size, without the game's buttons and panels. Each picture's
 * stage (the game's 360 × 640 area, which the scene is drawn around) goes in
 * site/assets/scenes/stage.json, so the website can find the door and the desks.
 *
 *   npm run site:shots
 */

const OUT = path.resolve('site', 'assets', 'scenes');
const VIEW = { width: 1920, height: 1080 };

test.use({ viewport: VIEW, deviceScaleFactor: 1.5 });

// The light follows the clock: late morning, so every picture's lit the same
// whenever they're taken.
test.beforeEach(async ({ page }) => {
  const morning = new Date();
  morning.setHours(11, 0, 0, 0);
  await page.clock.setSystemTime(morning);
});

// From src/world/carParkMap.ts (which needs React Native, so can't be imported here).
const BAYS = Array.from({ length: 12 }, (_, i) => ({
  x: 12 + (i % 6) * 56 + 28,
  top: [244, 424][Math.floor(i / 6)],
}));
const RACK_SLOTS = Array.from({ length: 12 }, (_, i) => ({
  x: 22 + i * 9.6,
  y: 222 + (i % 2) * 6,
}));

type Person = {
  name: string;
  look: Looks;
  vehicle: string | null;
  bay?: number;
  rack?: number;
  desk: DeskThing[];
  stall?: Listing[];
};

const thing = (item: string, x: number, y: number): DeskThing => ({ item, x, y });

/** Everyone about, by username. */
const PEOPLE: Record<string, Person> = {
  alice: {
    name: 'Alice',
    look: { skin: 0, colour: 3, hair: 'long', hair_colour: 4 },
    vehicle: 'hatchback',
    bay: 0,
    desk: [thing('lava_lamp', -38, -22), thing('mug', 34, -14)],
    stall: [{ id: 1, item: 'radish', qty: 6, price: 2 }],
  },
  bob: {
    name: 'Bob',
    look: { skin: 3, colour: 1, hair: 'short', hair_colour: 3 },
    vehicle: 'bike',
    rack: 1,
    desk: [thing('mug', -36, -24), thing('duck', 36, -16)],
    stall: [{ id: 2, item: 'strawberry', qty: 5, price: 3 }],
  },
  carol: {
    name: 'Carol',
    look: { skin: 1, colour: 2, hair: 'bun', hair_colour: 1 },
    vehicle: 'estate',
    bay: 2,
    desk: [thing('succulent', -38, -20), thing('lamp', 36, -22)],
  },
  dev: {
    name: 'Dev',
    look: { skin: 2, colour: 5, hair: 'shaved', hair_colour: 3 },
    vehicle: 'campervan',
    bay: 5,
    desk: [thing('radio', -36, -18)],
    stall: [{ id: 3, item: 'pumpkin', qty: 2, price: 9 }],
  },
  ellie: {
    name: 'Ellie',
    look: { skin: 0, colour: 6, hair: 'curly', hair_colour: 2 },
    vehicle: 'bike',
    rack: 4,
    desk: [thing('photo', -36, -20), thing('mug', 34, -14)],
  },
  finn: {
    name: 'Finn',
    look: { skin: 4, colour: 7, hair: 'short', hair_colour: 0 },
    vehicle: 'roadster',
    bay: 7,
    desk: [thing('bonsai', 36, -20)],
  },
  gus: {
    name: 'Gus',
    look: { skin: 5, colour: 4, hair: 'short', hair_colour: 3 },
    vehicle: 'hatchback',
    bay: 9,
    desk: [thing('lava_lamp', 36, -22)],
  },
  hana: {
    name: 'Hana',
    look: { skin: 1, colour: 0, hair: 'long', hair_colour: 3 },
    vehicle: 'bike',
    rack: 7,
    desk: [thing('lamp', -36, -22), thing('succulent', 36, -18)],
  },
  ivy: {
    name: 'Ivy',
    look: { skin: 3, colour: 3, hair: 'curly', hair_colour: 3 },
    vehicle: 'estate',
    bay: 11,
    desk: [thing('duck', -34, -16)],
  },
  jonah: {
    name: 'Jonah',
    look: { skin: 2, colour: 2, hair: 'long', hair_colour: 0 },
    vehicle: 'hatchback',
    bay: 6,
    desk: [thing('mug', 34, -14)],
  },
};

/** A friend at work: their status, where they are and their desk. Nobody's smoking: that's for players to find. */
function friend(
  username: string,
  status: Friend['status'],
  place: Friend['place'],
  desk: number
): Friend {
  const p = PEOPLE[username];
  const parked =
    p.bay !== undefined
      ? { x: BAYS[p.bay].x, y: BAYS[p.bay].top + 45, a: p.bay % 4 === 1 ? Math.PI : 0 }
      : p.rack !== undefined
        ? { x: RACK_SLOTS[p.rack].x, y: RACK_SLOTS[p.rack].y - 20, a: 0 }
        : null;
  return {
    username,
    display_name: p.name,
    status,
    ends_at: status === 'focused' ? iso(20 + desk * 3) : null,
    break_ends_at: status === 'on_break' ? iso(4) : null,
    desk,
    place,
    arrived_at: iso(-40),
    vehicle: p.vehicle,
    vehicle_health: 100,
    parked,
    desk_items: p.desk,
    activity: null,
    activity_until: null,
  };
}

/** Everyone's looks. */
function crowd(fake: FakeSupabase) {
  fake.looks = Object.fromEntries(Object.entries(PEOPLE).map(([u, p]) => [u, p.look]));
}

/** A broadcast on a Realtime channel, to every connection the page has open. */
function tell(fake: FakeSupabase, topic: string, event: string, payload: object) {
  const sockets = (fake as unknown as { sockets: { send: (m: string) => void }[] }).sockets;
  const message = [
    null,
    null,
    `realtime:${topic}`,
    'broadcast',
    { type: 'broadcast', event, payload },
  ];
  sockets.forEach((ws) => ws.send(JSON.stringify(message)));
}

const stages: Record<string, { x: number; y: number; width: number; height: number }> = {};

/**
 * Hides everything but the scene, and the words in it (name tags, place
 * labels, chat bubbles), notes where its stage is, and saves the picture as
 * site/assets/scenes/<name>.jpg.
 */
async function shoot(page: Page, name: string) {
  await page.clock.runFor(2500);
  await page.waitForTimeout(800);
  stages[name] = await page.evaluate(() => {
    const stage = [...document.querySelectorAll('div')].find((el) => {
      const s = getComputedStyle(el);
      return s.width === '360px' && s.height === '640px' && s.transform !== 'none';
    });
    if (!stage) throw new Error('No stage on the page');
    // The stage's parent holds the scene and its labels and chat bubbles; the
    // game's bars and panels are outside it.
    stage.parentElement!.setAttribute('data-scene', '');
    const style = document.createElement('style');
    style.textContent =
      'body * { visibility: hidden !important; } [data-scene], [data-scene] * { visibility: visible !important; }';
    document.head.append(style);
    // Every bit of text, and the pill or bubble it sits in.
    const scene = stage.parentElement!;
    for (const el of scene.querySelectorAll<HTMLElement>('*')) {
      const words = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      if (!words) continue;
      let box = el;
      while (
        box.parentElement &&
        box.parentElement !== scene &&
        box.parentElement.children.length === 1
      )
        box = box.parentElement;
      box.style.setProperty('visibility', 'hidden', 'important');
      box
        .querySelectorAll<HTMLElement>('*')
        .forEach((c) => c.style.setProperty('visibility', 'hidden', 'important'));
    }
    const r = stage.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  await page.waitForTimeout(200);
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), quality: 88 });
}

test.afterAll(() => {
  const file = path.join(OUT, 'stage.json');
  const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const all = { view: VIEW, ...before, ...stages };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + '\n');
});

test('car park', async ({ page, fake }) => {
  crowd(fake);
  fake.friends = [
    friend('alice', 'focused', 'office', 0),
    friend('bob', 'on_break', 'garden', 1),
    friend('carol', 'idle', 'outside', 2),
    friend('dev', 'focused', 'office', 3),
    friend('ellie', 'idle', 'outside', 5),
    friend('finn', 'focused', 'office', 6),
    friend('gus', 'on_break', 'garden', 7),
    friend('hana', 'focused', 'office', 8),
    friend('ivy', 'focused', 'office', 10),
    friend('jonah', 'idle', 'outside', 11),
  ];
  await fake.open('/');
  // Once the page has joined their channels.
  await page.waitForTimeout(2000);
  // Who's out in the car park.
  const out: [string, number, number][] = [
    ['carol', 240, 214],
    ['ellie', 272, 216],
    ['jonah', 200, 560],
  ];
  for (const [who, x, y] of out) tell(fake, `carpark:${who}`, 'pos', { x, y });
  await shoot(page, 'carpark');
});

/** Everyone in the office: who's studying, and at which desk. */
const AT_WORK = (): Friend[] => [
  friend('alice', 'focused', 'office', 0),
  friend('carol', 'focused', 'office', 2),
  friend('dev', 'focused', 'office', 3),
  friend('finn', 'focused', 'office', 6),
  friend('hana', 'idle', 'office', 8),
  friend('ivy', 'focused', 'office', 10),
  friend('jonah', 'focused', 'office', 4),
];
/** The desks nobody's at: where you can sit. */
const FREE_DESKS = [1, 5, 7, 9, 11];

test('office', async ({ page, fake }) => {
  crowd(fake);
  // In the office without a desk, so every free desk is free.
  Object.assign(fake.me, { status: 'idle', place: 'office', desk: null });
  fake.friends = AT_WORK();
  // Walking in would sit you at a desk: here you're still standing, so the
  // website's visitor picks one.
  const rpc = (fake as unknown as { rpc: Record<string, (args: unknown) => object> }).rpc;
  const setPlace = rpc.set_place;
  rpc.set_place = (args) => {
    const me = setPlace(args);
    fake.me.desk = null;
    return { ...me, desk: null };
  };
  await fake.open('/office');
  await shoot(page, 'office');
});

for (const desk of FREE_DESKS) {
  test(`office, studying at desk ${desk}`, async ({ page, fake }) => {
    crowd(fake);
    fake.studying(25);
    fake.me.desk = desk;
    fake.friends = AT_WORK();
    await fake.open('/office');
    await shoot(page, `office-${desk}`);
  });
}

test('garden', async ({ page, fake }) => {
  crowd(fake);
  fake.onBreak();
  fake.friends = Object.keys(PEOPLE).map((u, i) => friend(u, 'on_break', 'garden', i));
  fake.inGarden = [
    { username: 'alice', x: 470, y: 560 },
    { username: 'bob', x: 230, y: 610, sit: true },
    { username: 'carol', x: 258, y: 610, sit: true },
    { username: 'dev', x: 640, y: 560 },
    { username: 'ellie', x: 786, y: 610, sit: true },
    { username: 'finn', x: 1000, y: 610 },
    { username: 'gus', x: 600, y: 360 },
    { username: 'hana', x: 880, y: 470 },
    { username: 'ivy', x: 150, y: 470 },
    { username: 'jonah', x: 360, y: 300 },
  ];
  const plot = (bed: number, spot: number, crop: string, progress: number): Plot => ({
    bed,
    spot,
    crop,
    progress,
    grow_hours: 48,
    yield: 3,
    ripe: progress >= 1,
    withered: false,
    ripe_at: iso(60),
    withers_at: iso(600),
    watered: true,
    dry_at: iso(300),
    planted_at: iso(-600),
  });
  const CROPS = ['tomato', 'carrot', 'radish', 'sunflower', 'strawberry', 'pumpkin'];
  const beds = (seed: number) =>
    [0, 1, 2, 3].flatMap((bed) =>
      [0, 1, 2, 3]
        .filter((spot) => (seed + bed + spot) % 3 !== 0)
        .map((spot) =>
          plot(bed, spot, CROPS[(seed + bed) % CROPS.length], 0.45 + (((seed + spot) * 7) % 6) / 10)
        )
    );
  fake.plots = beds(5);
  const rpc = (fake as unknown as { rpc: Record<string, () => unknown> }).rpc;
  const garden = rpc.get_garden;
  rpc.get_garden = () => {
    const g = garden() as Garden;
    g.neighbours.forEach((n, i) => {
      n.plots = beds(i);
      n.stall = PEOPLE[n.username]?.stall ?? [];
    });
    return g;
  };
  await fake.open('/garden');
  await shoot(page, 'garden');
});
