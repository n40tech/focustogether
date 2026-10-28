import { DESKS, type Parked } from '@/lib/api';
import type { Point, Rect } from './gardenMap';

/**
 * The car park's layout, in stage units: one phone wide. The office and its
 * pavement are along the top, with the bike rack on the left and the hedge
 * and garden gate on the right; then two rows of six bays, with an aisle
 * between them wide enough to drive along, and more room below. You drive in
 * from the right, along the aisle.
 */
export const WORLD = { w: 360, h: 640 };

/** The office's front wall and pavement: cars stay below KERB_Y, bikes can go up to the rack. */
export const WALL_Y = 152;
export const KERB_Y = 236;
/** The hedge with the garden gate in it runs along the pavement from here. */
export const HEDGE_X = 300;
/** Where you stand when you come out of the office. */
export const DOOR: Point = { x: 180, y: 200 };
/** The office door's opening: walk up into it and you're inside. */
const DOORWAY = { x0: 150, x1: 210 };
export const BOARD: Point = { x: 265, y: 196 };
export const GATE: Point = { x: 326, y: 250 };
/** The gap in the hedge, which you can walk up through on a break. */
const GATEWAY = { x0: 312, x1: 340, y0: 176 };
/** Walk this far up the doorway or the gateway and you've gone through. */
export const IN_AT = 172;

/** A bay fits the longest vehicle (a campervan) with a little to spare. */
export const BAY_W = 56;
export const BAY_H = 90;
export const BAYS_PER_ROW = 6;
/** The rows' top lines: the aisle runs between them, and there's more room below. */
export const ROW_TOPS = [244, 424];
/** Where the bays start, from the left. */
export const BAYS_X = 12;
/** Twelve bays, two rows of six: each one's middle, and its top. */
export const BAYS = Array.from({ length: DESKS }, (_, i) => ({
  x: BAYS_X + (i % BAYS_PER_ROW) * BAY_W + BAY_W / 2,
  top: ROW_TOPS[Math.floor(i / BAYS_PER_ROW)],
}));
/** The middle of the aisle between the rows. */
export const AISLE_Y = (ROW_TOPS[0] + BAY_H + ROW_TOPS[1]) / 2;
/** The bike rack on the pavement, and its slots: where each bike's back wheel goes. */
export const RACK = { x: 16, y: 182, w: 118, h: 14 };
export const RACK_SLOTS: Point[] = Array.from({ length: DESKS }, (_, i) => ({
  x: 22 + i * 9.6,
  y: 222 + (i % 2) * 6,
}));
/** Lamp posts, below the bottom row: drive into one and your vehicle's damaged. */
export const LAMPS: Point[] = [
  { x: 20, y: 592 },
  { x: 340, y: 592 },
];

/** Where you come in: just past the right-hand edge, in the aisle, heading left. */
export const ENTRANCE: Parked = { x: 380, y: AISLE_Y, a: -Math.PI / 2 };
/** How far past the stage's edges you can drive (the car park carries on). */
const SIDES = { x0: -80, x1: 460 };

/** A vehicle's footprint: a size, and circles along its length for bumping into things. */
export type Shape = { w: number; h: number; r: number; speed: number; reverse: number };

export const SHAPES: Record<string, Shape> = {
  bike: { w: 16, h: 42, r: 4, speed: 110, reverse: 30 },
  hatchback: { w: 38, h: 58, r: 19, speed: 150, reverse: 60 },
  estate: { w: 40, h: 72, r: 20, speed: 150, reverse: 60 },
  campervan: { w: 44, h: 76, r: 22, speed: 120, reverse: 50 },
  roadster: { w: 38, h: 66, r: 19, speed: 170, reverse: 60 },
};
export const shapeOf = (model: string) => SHAPES[model] ?? SHAPES.hatchback;
export const isBike = (model: string) => model === 'bike';

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

/**
 * True if a posed vehicle would hit the kerb (cars), the office wall or the
 * hedge (bikes, which can ride onto the pavement to the rack), or the far
 * edges.
 */
export function offRoad(model: string, p: Parked) {
  const bike = isBike(model);
  return circlesOf(model, p).some(({ x, y, r }) => {
    if (x - r < SIDES.x0 || x + r > SIDES.x1 || y + r > WORLD.h + 20) return true;
    if (y - r < (bike ? WALL_Y + 8 : KERB_Y)) return true;
    return bike && x + r > HEDGE_X && y - r < KERB_Y - 4;
  });
}

/** True if a posed vehicle would hit a lamp post. */
export const hitsPole = (model: string, p: Parked) =>
  circlesOf(model, p).some(({ x, y, r }) =>
    LAMPS.some((l) => Math.hypot(x - l.x, y - l.y) < r + 5)
  );

/** Where a vehicle sits in bay `i`: in the middle of it, nose up (or down, `a` = pi). */
export function bayPose(i: number, model: string, a = 0): Parked {
  const bay = BAYS[i] ?? BAYS[0];
  return { x: bay.x, y: bay.top + BAY_H / 2, a };
}

/** Where a bike sits in rack slot `i`, nose in. */
export function slotPose(i: number): Parked {
  const s = RACK_SLOTS[i] ?? RACK_SLOTS[0];
  return { x: s.x, y: s.y - 20, a: 0 };
}

/** Facing straight up or straight down, give or take this much. */
const SQUARE = 0.4;

/**
 * The spot you'd park in, posed where you are: a free bay for a car (nose
 * either way), a free rack slot for a bike (nose in). Snapped straight, or
 * null if you're not in one yet.
 */
export function parkingSpot(
  model: string,
  p: Parked,
  others: { model: string; at: Parked }[]
): Parked | null {
  const facing = Math.atan2(Math.sin(p.a), Math.cos(p.a));
  const free = (spot: Parked) => !others.some((o) => overlaps(model, spot, o.model, o.at));
  if (isBike(model)) {
    if (Math.abs(facing) > SQUARE) return null;
    let best: Parked | null = null;
    let gap = 8;
    RACK_SLOTS.forEach((_, i) => {
      const spot = slotPose(i);
      const d = Math.abs(spot.x - p.x);
      if (d < gap && Math.abs(spot.y - p.y) < 16 && free(spot)) {
        best = spot;
        gap = d;
      }
    });
    return best;
  }
  const backwards = Math.abs(facing) > Math.PI - SQUARE;
  if (Math.abs(facing) > SQUARE && !backwards) return null;
  for (let i = 0; i < BAYS.length; i++) {
    const spot = bayPose(i, model, backwards ? Math.PI : 0);
    if (Math.abs(spot.x - p.x) < 14 && Math.abs(spot.y - p.y) < 20 && free(spot)) return spot;
  }
  return null;
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
  if (p.x < 6 || p.x > WORLD.w - 6 || p.y > WORLD.h - 4) return true;
  const inDoor = p.x >= DOORWAY.x0 && p.x <= DOORWAY.x1;
  const inGate = gateOpen && p.x >= GATEWAY.x0 && p.x <= GATEWAY.x1 && p.y >= GATEWAY.y0;
  if (p.y < WALL_Y + 12 && !inDoor) return true;
  if (p.y < IN_AT - 10) return true;
  if (p.x > HEDGE_X && p.y < KERB_Y - 4 && !inGate) return true;
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
  p.y < GATEWAY.y0 + 10 && p.x >= GATEWAY.x0 && p.x <= GATEWAY.x1;

/** Keeps a position from the network inside the car park (vehicles can be just past its sides). */
export const clampToCarPark = (p: Point): Point => ({
  x: Math.min(SIDES.x1, Math.max(SIDES.x0, p.x)),
  y: Math.min(WORLD.h + 20, Math.max(IN_AT, p.y)),
});

/** Beside a vehicle's driver's door, where you stand when you get out. */
export function besideVehicle(model: string, p: Parked): Point {
  const s = shapeOf(model);
  const side = s.w / 2 + 12;
  return { x: p.x - Math.cos(p.a) * side, y: p.y - Math.sin(p.a) * side };
}
