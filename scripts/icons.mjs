// Draws the Focus Together icon, two friends' hands clasped on sage, one
// wearing a watch at nine, and writes every size the app needs: the favicon,
// the web app icons and the native icons. The favicon shows just the watch on
// a wrist, so it still reads in a browser tab.
//
//   npm run icons
//
// Uses the Chromium that the browser tests install (npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// From src/lib/theme.ts: the day accent, paper and ink, and the night chip.
const SAGE = '#5f7d6a';
const PAPER = '#f8f4ec';
const INK = '#2d2b26';
const TICK = '#aaa294';
const GOLD = '#d9b06e';
const SHADE = '#14181e';

/** What each part is painted with. Two of the skin tones in src/art/People.tsx. */
const COLOURS = {
  left: '#f0d0b4',
  right: '#7f5539',
  ink: INK,
  paper: PAPER,
  tick: TICK,
  gold: GOLD,
};
const all = (colour) => Object.fromEntries(Object.keys(COLOURS).map((k) => [k, colour]));

// Everything is drawn on a 1024 square; c is its centre.
const c = 512;

/** A capsule from (x1, y1) to (x2, y2). */
const limb = ([x1, y1], [x2, y2], colour, width) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`;

/** A point d along the direction a (in degrees) from p. */
const along = ([x, y], a, d) => [
  x + Math.cos((a * Math.PI) / 180) * d,
  y + Math.sin((a * Math.PI) / 180) * d,
];

/** A rounded rectangle w by h centred on (x, y), turned by a degrees. */
const box = ([x, y], w, h, r, colour, a) =>
  `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="${r}" fill="${colour}" transform="rotate(${a} ${x} ${y})"/>`;

/**
 * A watch at nine on a wrist at p, its strap across an arm that points at a
 * degrees. The face is a rounded square of half-width r. Small ones lose the
 * ticks and get bolder hands, so they still read in a browser tab.
 */
function watch(p, a, r, arm, colours, { small = false } = {}) {
  const tilt = -6;
  const { ink, paper, tick, gold } = colours;
  const parts = [
    box(p, r * 1.1, arm + r * 0.4, r * 0.3, ink, a),
    box(along(p, tilt, r * 1.18), r * 0.22, r * 0.36, r * 0.08, ink, tilt),
    box(p, r * 2.3, r * 2.3, r * 0.62, ink, tilt),
    box(p, r * 2, r * 2, r * 0.5, paper, tilt),
  ];
  if (!small) {
    for (let t = tilt; t < 360; t += 90) {
      parts.push(limb(along(p, t, r * 0.7), along(p, t, r * 0.84), tick, r * 0.08));
    }
  }
  const bold = small ? 1.45 : 1;
  parts.push(limb(p, along(p, tilt - 90, r * 0.66), ink, r * 0.1 * bold)); // minutes: 12
  parts.push(limb(p, along(p, tilt + 180, r * 0.48), ink, r * 0.13 * bold)); // hours: 9
  parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${r * (small ? 0.12 : 0.1)}" fill="${gold}"/>`);
  return parts.join('');
}

/** The two hands clasped, with the watch on the left wrist: layers, back to front. */
function hands(colours) {
  const { left, right } = colours;
  const arm = 220;
  const a = 40; // the left arm comes in from the upper left
  const b = -15; // and the right one from the right
  const wristA = [370, 460];
  const middle = along(wristA, a, 240); // the middle of the left hand
  // The right hand lies over it, knuckles on its upper edge.
  const knuckles = along(middle, a - 90, 110);
  const wristB = along(knuckles, b, 120);
  // Its thumb lies over the back of the right hand.
  const thumb = along(along(wristA, a, 135), a - 90, 75);
  let rightHand = limb(along(wristB, b, 1200), wristB, right, arm);
  rightHand += limb(wristB, knuckles, right, arm + 10);
  // The right hand's fingers wrap over the left one.
  for (let i = 0; i < 4; i++) {
    const base = along(knuckles, a, (i - 1.5) * 64);
    rightHand += limb(base, along(base, a + 90, 175 - Math.abs(i - 1.5) * 30), right, 50);
  }
  return [
    limb(along(wristA, a, -1200), wristA, left, arm) +
      limb(wristA, along(wristA, a, 290), left, arm + 30),
    rightHand,
    limb(thumb, along(thumb, a - 70, 100), left, 62),
    watch(wristA, a, 80, arm, colours),
  ];
}

/** The watch alone on a wrist, for the favicon. */
const wrist = (colours) =>
  limb([-100, -100], [1124, 1124], colours.left, 470) +
  watch([c, c], 45, 225, 470, colours, { small: true });

/** Each layer over its own soft shadow, as the old clock had. */
const lifted = (draw) => {
  const shade = draw(all(SHADE));
  return draw(COLOURS)
    .map((layer, i) => `<g opacity="0.22" transform="translate(0 14)">${shade[i]}</g>${layer}`)
    .join('');
};

/** Draws at scale s about the centre, to keep inside a safe zone. */
const scaled = (s, body) =>
  `<g transform="translate(${c} ${c}) scale(${s}) translate(${-c} ${-c})">${body}</g>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`;

/** Sage to every edge: phones round the corners (or cut a circle) themselves. */
const full = (s) =>
  svg(`<rect width="1024" height="1024" fill="${SAGE}"/>${scaled(s, lifted(hands))}`);

/** A rounded sage tile with clear corners, for browsers and desktops. */
const tile = (body) =>
  svg(
    `<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>` +
      `<g clip-path="url(#tile)"><rect width="1024" height="1024" fill="${SAGE}"/>${body}</g>`
  );

/**
 * Android's themed icon: one colour. The hands are cut apart by thin gaps,
 * and the strap, case and clock hands are cut out.
 */
function mono(s) {
  const shapes = hands({ ...all('white'), ink: 'black', gold: 'black' });
  const gaps = hands(all('black'));
  const body = shapes
    .map((layer, i) => (i ? `<g filter="url(#gap)">${gaps[i]}</g>` : '') + layer)
    .join('');
  return svg(
    `<filter id="gap"><feMorphology operator="dilate" radius="14"/></filter>` +
      `<mask id="shape">${scaled(s, body)}</mask>` +
      `<rect width="1024" height="1024" fill="white" mask="url(#shape)"/>`
  );
}

// [file, size in pixels, drawing]. The hands and watch stay inside each
// platform's safe zone, with only the arms running out past it: 40% of the
// width for maskable icons, about 30% for Android's adaptive layers.
const icons = [
  ['assets/icon.png', 1024, full(1)],
  ['assets/favicon.png', 48, tile(wrist(COLOURS))],
  ['assets/android-icon-foreground.png', 512, svg(scaled(0.9, lifted(hands)))],
  [
    'assets/android-icon-background.png',
    512,
    svg(`<rect width="1024" height="1024" fill="${SAGE}"/>`),
  ],
  ['assets/android-icon-monochrome.png', 432, mono(0.9)],
  ['public/apple-touch-icon.png', 180, full(1)],
  ['public/logo192.png', 192, tile(scaled(0.95, lifted(hands)))],
  ['public/logo512.png', 512, tile(scaled(0.95, lifted(hands)))],
  ['public/maskable512.png', 512, full(1)],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, drawing] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0">${drawing.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
  );
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  await page.screenshot({ path: path.join(root, file), omitBackground: true });
  console.log(`${file} (${size}×${size})`);
}
await browser.close();
