import { BED, bedOrigin, PLOT } from '@/art/Garden';

/**
 * The garden's layout, in stage units: three phones wide and one tall. Plots
 * sit on a grid at the back, the gravel path runs along their front, and the
 * shed, the market square and the gate are along the bottom.
 */
export const WORLD = { w: 1080, h: 640 };

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Allotments: 7 × 3 cells, picked by plot_slot so they're where everyone expects. */
const GRID = { cols: 7, rows: 3, x: 31, y: 100, dx: 150, dy: 136 };
const CELLS = GRID.cols * GRID.rows;

const cellOrigin = (cell: number): Point => ({
  x: GRID.x + (cell % GRID.cols) * GRID.dx,
  y: GRID.y + Math.floor(cell / GRID.cols) * GRID.dy,
});

/**
 * Where each gardener's plot is (its top-left corner). Slots are handed out
 * once, so a plot never moves; slots past the grid wrap round, and the rare
 * clash moves along to the next free cell.
 */
export function plotSpots(gardeners: { username: string; plot_slot: number }[]) {
  const taken = new Set<number>();
  const spots = new Map<string, Point>();
  [...gardeners]
    .sort((a, b) => a.plot_slot - b.plot_slot)
    .forEach((g) => {
      let cell = g.plot_slot % CELLS;
      for (let i = 0; i < CELLS && taken.has(cell); i++) cell = (cell + 1) % CELLS;
      taken.add(cell);
      spots.set(g.username, cellOrigin(cell));
    });
  return spots;
}

export const plotRect = (at: Point): Rect => ({ x: at.x, y: at.y, w: PLOT.w, h: PLOT.h });
export const bedRect = (at: Point, bed: number): Rect => ({
  ...bedOrigin(at.x, at.y, bed),
  w: BED.w,
  h: BED.h,
});
/** Where someone stands when they're not walking about: just in front of their plot. */
export const besidePlot = (at: Point): Point => ({ x: at.x + PLOT.w / 2, y: at.y + PLOT.h + 20 });

export const FENCE_Y = 56;
export const PATH: Rect = { x: -2000, y: 474, w: 5080, h: 28 };
export const MARKET: Rect = { x: 380, y: 502, w: 320, h: 118 };
export const TABLES: Point[] = [405, 505, 605].map((x) => ({ x, y: 532 }));
/** The market's tables, for "am I at the market?". */
export const STALLS: Rect = { x: 402, y: 516, w: 276, h: 44 };
export const SHED: Point = { x: 40, y: 506 };
export const SHED_DOOR: Point = { x: SHED.x + 42, y: SHED.y + 96 };
export const BENCHES: Point[] = [
  { x: 214, y: 590 },
  { x: 770, y: 590 },
];
/**
 * Where you sit on a bench (two to a bench): your feet, just in front of it,
 * so you can get up and walk off.
 */
export const SEATS: Point[] = BENCHES.flatMap((b) => [
  { x: b.x + 16, y: b.y + 20 },
  { x: b.x + 44, y: b.y + 20 },
]);
/** The post box, bottom right: its foot. */
export const POSTBOX: Point = { x: 1010, y: 590 };
/** The garden's noticeboard (top-left corner of the board), by the market. */
export const NOTICEBOARD: Point = { x: 708, y: 520 };
/** The wheelie bins, one by the shed and one by the post box: their front-left corners. */
export const BINS: Point[] = [
  { x: 164, y: 570 },
  { x: 900, y: 570 },
];
/** A bin's footprint, for "am I next to it?". */
export const binRect = (b: Point): Rect => ({ x: b.x, y: b.y - 32, w: 24, h: 32 });
export const HEDGE_Y = 620;
/** Where you come in. */
export const GATE: Point = { x: 540, y: 606 };
/**
 * Where you appear as you come in: a few steps in from the gate, so you don't
 * walk straight back out of it.
 */
export const ENTRY: Point = { x: GATE.x, y: 580 };
/** Walk this far down through the gate and you've left the garden. */
export const GATE_OUT_Y = HEDGE_Y + 12;

/** Things you can't walk through, as rects your feet can't enter. */
const FIXTURES: Rect[] = [
  { x: SHED.x - 2, y: SHED.y - 4, w: 88, h: 90 },
  ...TABLES.map((t) => ({ x: t.x - 3, y: t.y - 16, w: 76, h: 44 })),
  ...BINS.map((b) => ({ x: b.x - 2, y: b.y - 14, w: 28, h: 16 })),
  ...BENCHES.map((b) => ({ x: b.x - 2, y: b.y - 6, w: 64, h: 24 })),
  { x: POSTBOX.x - 13, y: POSTBOX.y - 14, w: 26, h: 16 },
  { x: NOTICEBOARD.x - 2, y: NOTICEBOARD.y + 30, w: 56, h: 18 },
];
const BOUNDS = { x0: 12, x1: WORLD.w - 12, y0: FENCE_Y + 28, y1: HEDGE_Y - 4 };
/** The gap in the hedge, which you can walk out through. */
const GATEWAY = { x0: GATE.x - 16, x1: GATE.x + 16, y1: WORLD.h + 20 };
/** Half the width of someone's feet. */
const FEET = 6;

/** Obstacles for this garden: the fixtures, plus the plots you can see. */
export const obstaclesFor = (plots: Point[]): Rect[] => [
  ...FIXTURES,
  ...plots.map((p) => ({ x: p.x - 3, y: p.y - 2, w: PLOT.w + 6, h: PLOT.h + 4 })),
];

export function blocked(p: Point, obstacles: Rect[]) {
  const inGateway = p.x >= GATEWAY.x0 && p.x <= GATEWAY.x1 && p.y <= GATEWAY.y1;
  if (p.x < BOUNDS.x0 || p.x > BOUNDS.x1 || p.y < BOUNDS.y0 || (p.y > BOUNDS.y1 && !inGateway))
    return true;
  return obstacles.some(
    (r) => p.x + FEET > r.x && p.x - FEET < r.x + r.w && p.y > r.y && p.y < r.y + r.h
  );
}

const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** True on the gravel (the path and the market square), for the sound of your steps. */
export const onGravel = (p: Point) => inside(p, PATH) || inside(p, MARKET);

export function distToRect(p: Point, r: Rect) {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Keeps a world position inside the walkable area (for positions from the network). */
export const clampToGarden = (p: Point): Point => ({
  x: Math.min(BOUNDS.x1, Math.max(BOUNDS.x0, p.x)),
  y: Math.min(BOUNDS.y1, Math.max(BOUNDS.y0, p.y)),
});
