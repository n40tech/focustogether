// Draws the Focus Together icon and writes every size the app needs: the
// favicon, the web app icons and the native icons.
//
// Two friends, chest up in the bottom right, under the office clock in the
// top left. By day they're on the office wall, looking up at the clock. By
// night (iOS's dark icon) the clock says midnight and one of them is telling
// a ghost story by torchlight. The favicon is just the clock, so it still
// reads in a browser tab; its SVG version turns to night in dark mode.
//
//   npm run icons
//
// Uses the Chromium that the browser tests install (npx playwright install chromium).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// From src/lib/theme.ts: the office wall, paper and ink, and the night panel.
const WALL = '#e4dbcd';
const NIGHT = '#2a2f3b';
const PAPER = '#f8f4ec';
const INK = '#2d2b26';
const TICK = '#aaa294';
const SKIN = '#f0d0b4';

// Everything is drawn on a 1024 square; c is its centre.
const c = 512;

/** A rounded rectangle from its top left corner, like Box in src/art/primitives. */
const rect = (x, y, w, h, r, colour, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${colour}" ${extra}/>`;

/** A circle d across centred on (x, y), like Dot. */
const dot = (x, y, d, colour, extra = '') =>
  `<circle cx="${x}" cy="${y}" r="${d / 2}" fill="${colour}" ${extra}/>`;

/** A capsule from (x1, y1) to (x2, y2). */
const limb = (x1, y1, x2, y2, colour, width) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`;

/** The point d from (x, y) towards a clock angle (0 is twelve o'clock). */
const along = (x, y, deg, d) => [
  x + Math.sin((deg * Math.PI) / 180) * d,
  y - Math.cos((deg * Math.PI) / 180) * d,
];

/** A round office clock at (x, y), r in radius, showing h:m. Dim, it's in the dark. */
function clock(x, y, r, h, m, { dim = false } = {}) {
  const parts = [dot(x, y, r * 2.2, INK), dot(x, y, r * 2, dim ? '#d8d2c4' : PAPER)];
  for (let i = 0; i < 12; i++) {
    const major = i % 3 === 0;
    parts.push(
      limb(
        ...along(x, y, i * 30, r * 0.74),
        ...along(x, y, i * 30, r * (major ? 0.88 : 0.84)),
        major ? INK : TICK,
        r * (major ? 0.08 : 0.05)
      )
    );
  }
  parts.push(
    limb(x, y, ...along(x, y, (h % 12) * 30 + m / 2, r * 0.46), INK, r * 0.1),
    limb(x, y, ...along(x, y, m * 6, r * 0.68), INK, r * 0.07),
    dot(x, y, r * 0.16, INK)
  );
  return `<g ${dim ? 'opacity="0.8"' : ''}>${parts.join('')}</g>`;
}

/**
 * Eyes and a mouth on a face centred at the origin. `look` moves the eyes
 * sideways and `up` raises them; scared is wide-eyed with an open mouth.
 */
function face({ look = 0, up = 0, mood = 'smile' }) {
  if (mood === 'scared') {
    return (
      dot(-2.8 + look, 2, 3.2, '#fff') +
      dot(2.8 + look, 2, 3.2, '#fff') +
      dot(-2.8 + look * 1.6, 2, 1.7, INK) +
      dot(2.8 + look * 1.6, 2, 1.7, INK) +
      dot(look * 0.6, 6.2, 2.2, INK)
    );
  }
  const wide = mood === 'spooky' ? 2.2 : 2;
  const mouth = mood === 'spooky' ? [5.6, 7.6] : [5.4, 7];
  return (
    dot(-2.6 + look, 2.4 - up, 1.9, INK) +
    dot(2.6 + look, 2.4 - up, 1.9, INK) +
    `<path d="M ${-wide + look} ${mouth[0]} Q ${look} ${mouth[1]} ${wide + look} ${mouth[0]}" stroke="${INK}" stroke-width="0.9" fill="none" stroke-linecap="round"/>`
  );
}

/**
 * The blond one: a mop of curls to the jaw, a white tee and a grey patterned
 * jacket. Head centre (x, y), s pixels to a stage unit, as in src/art/People.
 */
function curls(x, y, s, expression) {
  const hair = '#c99c58';
  const dark = '#a97f43';
  const light = '#e0bc7c';
  const back = [
    [-8, -4.5], [8, -4.5], [-9.5, 0.5], [9.5, 0.5], [-8.8, 5], [8.8, 5],
    [-5, -8.5], [5, -8.5], [0, -10.2], [-2.6, -10], [2.6, -10],
  ];
  const front = [[-5.2, -5.4], [-1.8, -6.8], [1.8, -6.6], [5.2, -5], [-7, -2], [7, -2]];
  const pattern = [[-8.6, 14], [-6, 19], [-8, 24], [7.2, 15], [9, 21], [6.6, 25]];
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    back.map(([a, b], i) => dot(a, b, 7.6, i % 3 === 1 ? dark : hair)).join('') +
    rect(-11, 8, 22, 40, 8, '#efe8da') +
    rect(-11, 8, 7.5, 40, 4, '#8b8d91') +
    rect(3.5, 8, 7.5, 40, 4, '#8b8d91') +
    pattern.map(([a, b]) => rect(a - 0.9, b - 0.9, 1.8, 1.8, 0.4, '#6c6e72')).join('') +
    dot(0, 1.5, 13.6, SKIN) +
    front.map(([a, b], i) => dot(a, b, i > 3 ? 4.2 : 5.2, i % 2 ? hair : light)).join('') +
    face(expression) +
    `</g>`
  );
}

/**
 * The dark-haired one: a thick, shaggy mop to the chin with a ragged fringe,
 * a white tee and an open coral shirt. With a torch, it's under his chin.
 */
function mop(x, y, s, expression, { torch = false } = {}) {
  const hair = '#221d1c';
  const outline =
    'M -7.6 9.6 L -9.6 7.2 L -11.6 8 L -10.6 4.6 L -11.8 1.2 L -10.4 -0.6 L -11 -4.6 L -8.6 -8.4 L -4.6 -10.8 L 0 -11.4 L 4.6 -10.8 L 8.8 -8.2 L 10.8 -4.4 L 10.4 -1 L 11.9 1.6 L 10.6 4.6 L 11.8 8.2 L 9.6 7.4 L 7.8 9.8 Z';
  const fringe =
    'M -7.2 -0.6 L -6.6 -5.4 L -2.6 -7.6 L 2.8 -7.4 L 6.8 -4.6 L 7.3 0.6 L 6 -1.4 L 4.8 0.8 L 3.6 -1.2 L 2.2 0.4 L 1 -1.6 L -0.6 0 L -2 -1.8 L -3.6 -0.2 L -4.8 -2 L -6 -0.2 Z';
  const locks =
    'M -7.4 -2 L -5.4 0.4 L -5.6 5 L -6.4 8.4 L -8 6 Z M 7.4 -2 L 5.4 0.4 L 5.6 5 L 6.4 8.4 L 8 6 Z';
  const soft = `stroke="${hair}" stroke-width="1.2" stroke-linejoin="round"`;
  return (
    `<g transform="translate(${x} ${y}) scale(${s})">` +
    `<path d="${outline}" fill="${hair}" ${soft}/>` +
    rect(-11, 8, 22, 40, 8, '#efe8da') +
    rect(-11, 8, 7.5, 40, 4, '#d9765a') +
    rect(3.5, 8, 7.5, 40, 4, '#d9765a') +
    rect(-2.6, 16, 5.2, 5, 1, '#9fb0bf') +
    dot(0, 1.5, 13.6, SKIN) +
    face(expression) +
    (torch ? torchUnderChin() : '') +
    `<path d="${fringe}" fill="${hair}" ${soft}/>` +
    `<path d="${locks}" fill="${hair}" ${soft}/>` +
    `</g>`
  );
}

/** A torch held under the chin, shining up the face (under the fringe). */
const torchUnderChin = () =>
  limb(-10, 30, -2.5, 13.5, '#d9765a', 5.5) +
  `<path d="M -6.2 -3.5 Q 0 -6.5 6.2 -3.5 L 2.2 10.6 L -2.2 10.6 Z" fill="url(#beam)"/>` +
  dot(0, 1.5, 13.6, '#ffe7a8', 'opacity="0.28"') +
  rect(-1.8, 10.4, 3.6, 7, 1, '#4a4644') +
  rect(-2.3, 9.6, 4.6, 2, 0.8, '#6b6663') +
  dot(0, 9.8, 3.4, '#fff7da') +
  dot(-1.5, 15, 4.6, SKIN);

// Where the two of them stand (head centres) and the clock hangs.
const LEFT = [596, 650];
const RIGHT = [830, 680];
const SIZE = 13;
const CLOCK = [290, 290, 160];

/** The scene in layers, back to front, without the wall. */
const scene = {
  // Looking up at the clock.
  day: () => [
    clock(...CLOCK, 10, 8),
    curls(...LEFT, SIZE, { look: -1.4, up: 1.2 }),
    mop(...RIGHT, SIZE, { look: -2, up: 0.5 }),
  ],
  // Midnight: a ghost story by torchlight.
  night: () => [
    clock(...CLOCK, 12, 0, { dim: true }),
    `<ellipse cx="${RIGHT[0] - 20}" cy="${RIGHT[1] - 10}" rx="330" ry="300" fill="url(#glow)"/>`,
    curls(...LEFT, SIZE, { look: 1.4, mood: 'scared' }),
    mop(...RIGHT, SIZE, { look: -0.6, mood: 'spooky' }, { torch: true }),
  ],
};
const BACK = { day: WALL, night: NIGHT };
const SHADOW = { day: 0.16, night: 0.35 };

/** Each layer over its own soft shadow (the torch's glow casts none). */
const lifted = (mode) =>
  scene[mode]()
    .map((layer) =>
      layer.startsWith('<ellipse')
        ? layer
        : `<g opacity="${SHADOW[mode]}" transform="translate(0 14)" filter="url(#shade)">${layer}</g>${layer}`
    )
    .join('');

const DEFS =
  `<filter id="shade"><feFlood flood-color="#14181e"/><feComposite in2="SourceAlpha" operator="in"/></filter>` +
  `<radialGradient id="glow"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.38"/><stop offset="0.6" stop-color="#ffd98a" stop-opacity="0.08"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient>` +
  `<linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff3c4" stop-opacity="0.75"/><stop offset="1" stop-color="#fff3c4" stop-opacity="0"/></linearGradient>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs>${DEFS}</defs>${body}</svg>`;

/** Draws at scale s about the centre, to keep inside a safe zone. */
const scaled = (s, body) =>
  `<g transform="translate(${c} ${c}) scale(${s}) translate(${-c} ${-c})">${body}</g>`;

const wall = (mode) => `<rect width="1024" height="1024" fill="${BACK[mode]}"/>`;

/** Wall to every edge: phones round the corners (or cut a circle) themselves. */
const full = (mode, s = 1) => svg(wall(mode) + scaled(s, lifted(mode)));

/** A rounded tile with clear corners, for browsers and desktops. */
const tile = (mode, body) =>
  svg(
    `<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>` +
      `<g clip-path="url(#tile)">${wall(mode)}${body}</g>`
  );

/**
 * Android's themed icon: one colour. The clock is a ring with its hands, and
 * the two of them are silhouettes cut apart by a thin gap, with their eyes
 * cut out.
 */
function mono(s) {
  const [x, y, r] = CLOCK;
  // Every colour in a drawing becomes one; an outline (in stage units) fattens
  // each shape, to cut a gap around it.
  const paint = (drawing, colour, outline = 0) => {
    const flat = drawing.replace(/(fill|stroke)="#[0-9a-fA-F]{3,6}"/g, `$1="${colour}"`);
    return outline
      ? flat.replace(
          /<(rect|circle|path) /g,
          `<$1 stroke="${colour}" stroke-width="${outline}" stroke-linejoin="round" `
        )
      : flat;
  };
  const eyes = ([hx, hy], expression) =>
    `<g transform="translate(${hx} ${hy}) scale(${SIZE})">${paint(face(expression), 'black')}</g>`;
  const looks = { left: { look: -1.4, up: 1.2 }, right: { look: -2, up: 0.5 } };
  const left = curls(...LEFT, SIZE, looks.left);
  const right = mop(...RIGHT, SIZE, looks.right);
  const ticks = [0, 3, 6, 9]
    .map((i) =>
      limb(...along(x, y, i * 30, r * 0.74), ...along(x, y, i * 30, r * 0.88), 'white', r * 0.08)
    )
    .join('');
  const body =
    dot(x, y, r * 2.2, 'white') +
    dot(x, y, r * 1.9, 'black') +
    ticks +
    limb(x, y, ...along(x, y, 10 * 30 + 4, r * 0.46), 'white', r * 0.12) +
    limb(x, y, ...along(x, y, 48, r * 0.68), 'white', r * 0.09) +
    paint(left, 'white') +
    eyes(LEFT, looks.left) +
    paint(right, 'black', 2.4) +
    paint(right, 'white') +
    eyes(RIGHT, looks.right);
  return svg(
    `<mask id="shape">${scaled(s, body)}</mask>` +
      `<rect width="1024" height="1024" fill="white" mask="url(#shape)"/>`
  );
}

/** The favicon: just the clock, big, on a rounded tile. */
const favicon = (mode) =>
  tile(mode, mode === 'day' ? clock(c, c, 400, 10, 8) : clock(c, c, 400, 12, 0, { dim: true }));

/**
 * The favicon as one SVG for browsers: the clock by day, and at midnight on
 * the night colour when the browser is in dark mode.
 */
const faviconSvg = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
  `<style>.night{display:none}@media (prefers-color-scheme: dark){.day{display:none}.night{display:inline}}</style>` +
  `<clipPath id="tile"><rect width="1024" height="1024" rx="230"/></clipPath>` +
  `<g clip-path="url(#tile)"><g class="day">${wall('day')}${clock(c, c, 400, 10, 8)}</g>` +
  `<g class="night">${wall('night')}${clock(c, c, 400, 12, 0, { dim: true })}</g></g></svg>`;

// On Android the people and the clock are scaled into the adaptive icon's
// safe zone, so a round mask doesn't cut the clock. The web's maskable icon
// does the same, on the wall.
const SAFE = 0.66;

// [file, size in pixels, drawing].
const icons = [
  ['assets/icon.png', 1024, full('day')],
  ['assets/icon-dark.png', 1024, full('night')],
  ['public/favicon.png', 48, favicon('day')],
  ['assets/android-icon-foreground.png', 512, svg(scaled(SAFE, lifted('day')))],
  ['assets/android-icon-background.png', 512, svg(wall('day'))],
  ['assets/android-icon-monochrome.png', 432, mono(SAFE)],
  ['public/apple-touch-icon.png', 180, full('day')],
  ['public/logo192.png', 192, tile('day', lifted('day'))],
  ['public/logo512.png', 512, tile('day', lifted('day'))],
  ['public/maskable512.png', 512, full('day', SAFE)],
];

fs.writeFileSync(path.join(root, 'public/favicon.svg'), faviconSvg());
console.log('public/favicon.svg');

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
