// Draws the Focus Together icon, two of the game's people in front of a timer
// on sage, and writes every size the app needs: the favicon, the web app
// icons and the native icons. The favicon shows just the timer, so it still
// reads in a browser tab.
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

/** What each part is painted with: two people in looks from src/lib/looks.ts, and the timer. */
const COLOURS = {
  shirtA: '#7a8fb0', // blue, on fair skin with brown hair
  skinA: '#f0d0b4',
  hairA: '#6b4a33',
  shirtB: '#b0857a', // clay, on brown skin with black hair in a bun
  skinB: '#7f5539',
  hairB: '#2d2d33',
  legs: '#4a4d55',
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

/** A point d along the direction a (in degrees, 0 is 3 o'clock) from p. */
const along = ([x, y], a, d) => [
  x + Math.cos((a * Math.PI) / 180) * d,
  y + Math.sin((a * Math.PI) / 180) * d,
];

/** A rounded rectangle from its top left corner, like Box in src/art/primitives. */
const rect = (x, y, w, h, r, colour) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${colour}"/>`;

/** A circle d across centred on (x, y), like Dot. */
const dot = (x, y, d, colour) => `<circle cx="${x}" cy="${y}" r="${d / 2}" fill="${colour}"/>`;

/**
 * One of the game's people standing, as Person in src/art/People.tsx draws
 * them, with short hair or a bun: feet at (x, y), s pixels to a stage unit.
 */
function person(x, y, s, [shirt, skin, hair], colours, { bun = false } = {}) {
  const hairline = bun ? 3.5 : 4;
  // The face is a circle cut off at the hairline, with the hair behind it.
  const edge = -40 + hairline;
  const half = Math.sqrt(49 - (edge + 33) ** 2);
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    rect(-5, -9, 4, 9, 2, colours.legs) +
    rect(1, -9, 4, 9, 2, colours.legs) +
    rect(-9, -27, 18, 20, 7, shirt) +
    dot(0, -35, 16, hair) +
    (bun ? dot(0, -43.5, 7, hair) : '') +
    `<path d="M ${-half} ${edge} A 7 7 0 1 0 ${half} ${edge} Z" fill="${skin}"/>` +
    dot(-3, -32, 2, colours.ink) +
    dot(3, -32, 2, colours.ink) +
    (bun ? '' : rect(-1, -37, 9, 3, 1.5, hair)) +
    `</g>`
  );
}

/**
 * A stopwatch centred on p with a face r in radius, a gold wedge on it for
 * 25 minutes. Small ones lose the ticks, so they still read in a browser tab.
 */
function timer(p, r, colours, { small = false } = {}) {
  const { ink, paper, tick, gold } = colours;
  const [x, y] = p;
  const [ex, ey] = along(p, -90 + 150, r * 0.9);
  const parts = [
    rect(x - r * 0.16, y - r * 1.3, r * 0.32, r * 0.3, r * 0.04, ink),
    rect(x - r * 0.3, y - r * 1.46, r * 0.6, r * 0.2, r * 0.1, ink),
    limb(along(p, -45, r), along(p, -45, r * 1.24), ink, r * 0.2),
    dot(x, y, r * 2.24, ink),
    dot(x, y, r * 2, paper),
    `<path d="M ${x} ${y} L ${x} ${y - r * 0.9} A ${r * 0.9} ${r * 0.9} 0 0 1 ${ex} ${ey} Z" fill="${gold}"/>`,
  ];
  if (!small) {
    for (let t = 0; t < 360; t += 30) {
      parts.push(limb(along(p, t, r * 0.74), along(p, t, r * 0.86), tick, r * 0.06));
    }
  }
  parts.push(dot(x, y, r * (small ? 0.3 : 0.2), ink));
  return parts.join('');
}

/** Two friends in front of a timer: layers, back to front. */
const together = (colours) => [
  timer([c, 430], 210, colours),
  person(c - 120, 990, 12, [colours.shirtA, colours.skinA, colours.hairA], colours),
  person(c + 120, 990, 12, [colours.shirtB, colours.skinB, colours.hairB], colours, { bun: true }),
];

/** The timer alone, for the favicon. */
const alone = (colours) => timer([c, 560], 330, colours, { small: true });

/** Each layer over its own soft shadow. */
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
  svg(`<rect width="1024" height="1024" fill="${SAGE}"/>${scaled(s, lifted(together))}`);

/** A rounded sage tile with clear corners, for browsers and desktops. */
const tile = (body) =>
  svg(
    `<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>` +
      `<g clip-path="url(#tile)"><rect width="1024" height="1024" fill="${SAGE}"/>${body}</g>`
  );

/**
 * Android's themed icon: one colour. The people and the timer are cut apart
 * by thin gaps, and the eyes, the timer's case and its wedge are cut out.
 */
function mono(s) {
  const shapes = together({ ...all('white'), ink: 'black', gold: 'black' });
  const gaps = together(all('black'));
  const body = shapes
    .map((layer, i) => (i ? `<g filter="url(#gap)">${gaps[i]}</g>` : '') + layer)
    .join('');
  return svg(
    `<filter id="gap"><feMorphology operator="dilate" radius="14"/></filter>` +
      `<mask id="shape">${scaled(s, body)}</mask>` +
      `<rect width="1024" height="1024" fill="white" mask="url(#shape)"/>`
  );
}

// [file, size in pixels, drawing]. The timer and the people's heads stay
// inside each platform's safe zone, with only their legs running out past
// it: 40% of the width for maskable icons, about 30% for Android's adaptive
// layers.
const icons = [
  ['assets/icon.png', 1024, full(1)],
  ['assets/favicon.png', 48, tile(alone(COLOURS))],
  ['assets/android-icon-foreground.png', 512, svg(scaled(0.8, lifted(together)))],
  [
    'assets/android-icon-background.png',
    512,
    svg(`<rect width="1024" height="1024" fill="${SAGE}"/>`),
  ],
  ['assets/android-icon-monochrome.png', 432, mono(0.8)],
  ['public/apple-touch-icon.png', 180, full(1)],
  ['public/logo192.png', 192, tile(scaled(0.95, lifted(together)))],
  ['public/logo512.png', 512, tile(scaled(0.95, lifted(together)))],
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
