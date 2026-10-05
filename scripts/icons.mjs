// Draws the Focus Together icon, a clock at nine on sage, and writes every size
// the app needs: the favicon, the web app icons and the native icons.
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
const SHADOW = 'rgba(20, 24, 30, 0.22)';

// Everything is drawn on a 1024 square; c is its centre.
const c = 512;

const line = (x1, y1, x2, y2, colour, width) =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`;

/**
 * The clock at nine, with radius r. Small ones lose the ticks and the shadow
 * and get bolder hands, so they still read in a browser tab.
 */
function clock(r, { small = false } = {}) {
  const parts = [];
  if (!small) parts.push(`<circle cx="${c}" cy="${c + r * 0.05}" r="${r}" fill="${SHADOW}"/>`);
  parts.push(`<circle cx="${c}" cy="${c}" r="${r}" fill="${PAPER}"/>`);
  if (!small) {
    for (let hour = 0; hour < 12; hour++) {
      const a = (hour / 12) * 2 * Math.PI;
      const [x, y] = [Math.sin(a), -Math.cos(a)];
      parts.push(
        hour % 3 === 0
          ? line(
              c + x * r * 0.72,
              c + y * r * 0.72,
              c + x * r * 0.84,
              c + y * r * 0.84,
              TICK,
              r * 0.07
            )
          : `<circle cx="${c + x * r * 0.78}" cy="${c + y * r * 0.78}" r="${r * 0.03}" fill="${TICK}"/>`
      );
    }
  }
  const bold = small ? 1.45 : 1;
  parts.push(line(c, c, c, c - r * (small ? 0.62 : 0.66), INK, r * 0.095 * bold)); // minutes: 12
  parts.push(line(c, c, c - r * (small ? 0.46 : 0.48), c, INK, r * 0.12 * bold)); // hours: 9
  parts.push(`<circle cx="${c}" cy="${c}" r="${r * (small ? 0.1 : 0.085)}" fill="${GOLD}"/>`);
  return parts.join('');
}

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${body}</svg>`;

/** Sage to every edge: phones round the corners (or cut a circle) themselves. */
const full = (r) => svg(`<rect width="1024" height="1024" fill="${SAGE}"/>${clock(r)}`);

/** A rounded sage tile with clear corners, for browsers and desktops. */
const tile = (r, opts) =>
  svg(`<rect width="1024" height="1024" rx="230" fill="${SAGE}"/>${clock(r, opts)}`);

/** Android's themed icon: one colour, with the hands cut out of the face. */
const mono = (r) =>
  svg(
    `<mask id="hands"><rect width="1024" height="1024" fill="white"/>` +
      line(c, c, c, c - r * 0.66, 'black', r * 0.11) +
      line(c, c, c - r * 0.48, c, 'black', r * 0.14) +
      `</mask><circle cx="${c}" cy="${c}" r="${r}" fill="white" mask="url(#hands)"/>`
  );

// [file, size in pixels, drawing]. The clock stays inside each platform's
// safe zone: 40% of the width for maskable icons, about 30% for Android's
// adaptive layers.
const icons = [
  ['assets/icon.png', 1024, full(330)],
  ['assets/favicon.png', 48, tile(410, { small: true })],
  ['assets/android-icon-foreground.png', 512, svg(clock(290))],
  [
    'assets/android-icon-background.png',
    512,
    svg(`<rect width="1024" height="1024" fill="${SAGE}"/>`),
  ],
  ['assets/android-icon-monochrome.png', 432, mono(290)],
  ['public/apple-touch-icon.png', 180, full(330)],
  ['public/logo192.png', 192, tile(350)],
  ['public/logo512.png', 512, tile(350)],
  ['public/maskable512.png', 512, full(330)],
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
