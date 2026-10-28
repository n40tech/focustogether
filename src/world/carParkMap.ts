import { DESKS, type Parked } from '@/lib/api';
import type { Point, Rect } from './gardenMap';

/**
 * The car park's layout, in stage units: two phones wide and one tall. The
 * office and its pavement are along the top, then two rows of eight bays with
 * an aisle between, a verge, and the road along the bottom. You drive in
 * from the road through the gap at the right-hand end of the verge.
 */
export const WORLD = { w: 720, h: 640 };

/** The office's front wall and pavement: nobody drives above KERB_Y. */
export const WALL_Y = 152;
export const KERB_Y = 236;
/** The hedge with the garden gate in it runs along the pavement from here. */
export const HEDGE_X = 520;
export const DOOR: Point = { x: 180, y: 166 };
/** The office door's opening: walk up into it and you're inside. */
const DOORWAY = { x0: 150, x1: 210 };
export const BOARD: Point = { x: 265, y: 166 };
export const GATE: Point = { x: 550, y: 240 };
/** The gap in the hedge, which you can walk up through on a break. */
const GATEWAY = { x0: 536, x1: 564, y0: 176 };
/** Walk this far up the doorway or the gateway and you've gone through. */
export const IN_AT = 172;

export const BAY_W = 75;
export const BAY_H = 92;
export const ROWS = [240, 432];
/** The verge between the bottom row and the road, with the entrance at its right. */
export const VERGE = { y0: 524, y1: 548, gap: 640 };
export const BAYS_PER_ROW = 8;
/** Where a vehicle sits, centred, in each bay (row by row). */
export const BAYS: Parked[] = Array.from({ length: BAYS_PER_ROW * 2 }, (_, i) => ({
  x: 30 + (i % BAYS_PER_ROW) * BAY_W + BAY_W / 2,
  y: ROWS[Math.floor(i / BAYS_PER_ROW)] + BAY_H / 2,
  a: 0,
}));
/** The bike rack on the pavement. */
export const RACK = { x: 16, y: 182, w: 120, h: 14 };
export const RACK_SLOTS: Point[] = Array.from({ length: DESKS }, (_, i) => ({
  x: 22 + i * 9.6,
  y: 222 + (i % 2) * 6,
}));
export const LAMPS: Point[] = [
  { x: 200, y: 540 },
  { x: 470, y: 540 },
];

/** Where you come in: on the road at the entrance, facing into the car park. */
export const ENTRANCE: Parked = { x: 680, y: 600, a: 0 };

/** A vehicle's footprint: a size, and circles along its length for bumping into things. */
export type Shape = { w: number; h: number; r: number; speed: number; reverse: number };

export const SHAPES: Record<string, Shape> = {
  bike: { w: 16, h: 42, r: 8, speed: 110, reverse: 30 },
  hatchback: { w: 38, h: 58, r: 19, speed: 150, reverse: 60 },
  estate: { w: 40, h: 72, r: 20, speed: 150, reverse: 60 },
  campervan: { w: 44, h: 76, r: 22, speed: 120, reverse: 50 },
  roadster: { w: 38, h: 66, r: 19, speed: 170, reverse: 60 },
};
export const shapeOf = (model: string) => SHAPES[model] ?? SHAPES.hatchback;

/** The circles a vehicle covers, posed at `p` (its centre) and heading `p.a`. */
export function circlesOf(model: string, p: Parked) {
  const s = shapeOf(model);
  const reach = Math.max(0, s.h / 2 - s.r);
  const dx = Math.sin(p.a);
  const dy = -Math.cos(p.a);
  return [-reach, 0, reach].map((k) => ({ x: p.x + dx * k, y: p.y + dy * k, r: s.r }));
}

/** True if two posed vehicles overlap. */
export function overlaps(a: string, pa: Parked, b: string, pb: Parked) {
  const ca = circlesOf(a, pa);
  const cb = circlesOf(b, pb);
  return ca.some((p) => cb.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r));
}

/** True if a posed vehicle would hit the kerb, the verge, a lamp post or the edge. */
export function offRoad(model: string, p: Parked) {
  return circlesOf(model, p).some(({ x, y, r }) => {
    if (x - r < 0 || x + r > WORLD.w || y - r < KERB_Y || y + r > WORLD.h) return true;
    // The verge, except at the entrance.
    if (y + r > VERGE.y0 && y - r < VERGE.y1 && x - r < VERGE.gap) return true;
    return LAMPS.some((l) => Math.hypot(x - l.x, y - l.y) < r + 5);
  });
}

/** Half the width of someone's feet. */
const FEET = 6;
const FIXTURES: Rect[] = [RACK, ...LAMPS.map((l) => ({ x: l.x - 5, y: l.y - 6, w: 10, h: 8 }))];

/**
 * True if someone on foot can't stand at `p`: the office wall (bar its door),
 * the hedge (bar its gate, and only on a break), the rack, a lamp post, the
 * edges, or a vehicle.
 */
export function blockedOnFoot(
  p: Point,
  vehicles: { model: string; at: Parked }[],
  gateOpen: boolean
) {
  if (p.x < 8 || p.x > WORLD.w - 8 || p.y > WORLD.h - 4) return true;
  const inDoor = p.x >= DOORWAY.x0 && p.x <= DOORWAY.x1;
  const inGate = gateOpen && p.x >= GATEWAY.x0 && p.x <= GATEWAY.x1 && p.y >= GATEWAY.y0;
  if (p.y < WALL_Y + 12 && !inDoor) return true;
  if (p.y < IN_AT - 10) return true;
  if (p.x > HEDGE_X && p.y < KERB_Y && !inGate) return true;
  if (
    FIXTURES.some((r) => p.x + FEET > r.x && p.x - FEET < r.x + r.w && p.y > r.y && p.y < r.y + r.h)
  )
    return true;
  return vehicles.some(({ model, at }) =>
    circlesOf(model, at).some((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r + FEET - 2)
  );
}

/** Through the office door, or (on a break) the garden gate. */
export const throughDoor = (p: Point) => p.y < IN_AT && p.x >= DOORWAY.x0 && p.x <= DOORWAY.x1;
export const throughGate = (p: Point) =>
  p.y < KERB_Y - 50 && p.x >= GATEWAY.x0 && p.x <= GATEWAY.x1;

/** Keeps a position from the network inside the car park. */
export const clampToCarPark = (p: Point): Point => ({
  x: Math.min(WORLD.w - 8, Math.max(8, p.x)),
  y: Math.min(WORLD.h - 4, Math.max(IN_AT, p.y)),
});

/** Beside a vehicle's driver's door, where you stand when you get out. */
export function besideVehicle(model: string, p: Parked): Point {
  const s = shapeOf(model);
  const side = s.w / 2 + 12;
  return { x: p.x - Math.cos(p.a) * side, y: p.y - Math.sin(p.a) * side };
}
