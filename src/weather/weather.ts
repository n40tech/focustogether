/**
 * The shared weather. Every player computes it from the same (server-corrected)
 * clock, so friends always see and hear the same sky without a server.
 *
 * Smooth value noise on a few time scales gives slowly drifting cloud, rain and
 * wind; storms and lightning strikes fall out of those deterministically too.
 * This file is pure (no React, no platform APIs) so it can be ported to SQL or
 * an Edge Function if the server ever needs to know whether it's raining.
 */

export type Weather = {
  /** 0 clear … 1 thick overcast */
  cloud: number;
  /** 0 dry … 1 downpour */
  rain: number;
  /** 0 still … 1 gale (the slow average; see gustAt for the moment-to-moment) */
  wind: number;
  /** 0 … 1, how thundery it is */
  storm: number;
  /** 0 … 1 mist; settles on still, damp mornings */
  fog: number;
};

const MINUTE = 60_000;

// Distinct seeds so each quantity drifts independently.
const SEED = { cloud: 0x51f1, wet: 0x7a31, wind: 0x2c9b, gust: 0x6e07, strike: 0x13d5 };

/** Integer hash -> [0, 1). */
function hash(n: number, seed: number): number {
  let h = Math.imul((n | 0) ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** 1D value noise in [0, 1): one random value per integer, eased between. */
function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  return lerp(hash(i, seed), hash(i + 1, seed), fade(x - i));
}

/** Noise layered over several periods (in minutes) with the given weights. */
function layered(minutes: number, seed: number, layers: [period: number, weight: number][]) {
  let sum = 0;
  let total = 0;
  layers.forEach(([period, weight], k) => {
    sum += noise(minutes / period, seed + k * 101) * weight;
    total += weight;
  });
  return sum / total;
}

/** Hours (0–24, local) when the morning mist can settle. */
function mistiness(localHour: number) {
  return smoothstep(3.5, 5.5, localHour) * (1 - smoothstep(8.5, 10.5, localHour));
}

/**
 * The weather at a moment. `localHour` (0–24) only affects fog, which is the one
 * thing that depends on where you are in the day.
 */
export function weatherAt(ms: number, localHour = 12): Weather {
  const t = ms / MINUTE;

  // Weather systems roll through over a few hours, with shorter wobbles on top.
  const c = layered(t, SEED.cloud, [
    [240, 0.7],
    [55, 0.25],
    [13, 0.05],
  ]);
  const cloud = smoothstep(0.18, 0.76, c);

  // Rain needs heavy cloud *and* a wet spell, so some overcast days stay dry.
  const wet = layered(t, SEED.wet, [
    [70, 0.8],
    [15, 0.2],
  ]);
  const rain = smoothstep(0.6, 0.95, cloud) * smoothstep(0.4, 0.85, wet);

  const w = layered(t, SEED.wind, [
    [150, 0.75],
    [30, 0.25],
  ]);
  const wind = clamp01(0.06 + smoothstep(0.28, 0.85, w) * 0.94);

  const storm = smoothstep(0.6, 0.95, rain) * smoothstep(0.55, 0.85, wind);

  const fog = mistiness(localHour) * (1 - wind) ** 2 * smoothstep(0.3, 0.7, cloud) * (1 - rain);

  return { cloud, rain, wind, storm, fog };
}

/** How wet the ground is (0–1): puddles linger for about an hour after rain. */
export function wetnessAt(ms: number): number {
  let wet = 0;
  for (let k = 0; k <= 6; k++) {
    wet = Math.max(wet, weatherAt(ms - k * 10 * MINUTE).rain * (1 - k / 7));
  }
  return wet;
}

/** Moment-to-moment wind strength (0–1): the average wind plus shared gusts. */
export function gustAt(ms: number, wind = weatherAt(ms).wind): number {
  const g = layered(ms / MINUTE, SEED.gust, [
    [0.6, 0.6],
    [0.15, 0.4],
  ]);
  return clamp01(wind * (0.55 + 0.9 * g));
}

const STRIKE_SLOT_MS = 20_000;

/** Distance of a strike, 0 (overhead) … 1 (far off), the same for everyone. */
export function strikeDistance(atMs: number): number {
  return hash(Math.floor(atMs), SEED.strike + 2);
}

/**
 * Lightning strikes in [fromMs, toMs). Each 20 s slot holds at most one, at a
 * hashed offset, with a chance that grows with the storm. Being deterministic,
 * everyone in the garden hears the same thunder at the same moment.
 */
export function strikesBetween(
  fromMs: number,
  toMs: number,
  stormAt: (ms: number) => number = (ms) => weatherAt(ms).storm
): number[] {
  const strikes: number[] = [];
  for (let slot = Math.floor(fromMs / STRIKE_SLOT_MS); slot * STRIKE_SLOT_MS < toMs; slot++) {
    const start = slot * STRIKE_SLOT_MS;
    const storm = stormAt(start);
    if (storm <= 0 || hash(slot, SEED.strike) >= storm * 0.3) continue;
    const at = start + hash(slot, SEED.strike + 1) * STRIKE_SLOT_MS;
    if (at >= fromMs && at < toMs) strikes.push(at);
  }
  return strikes;
}

/** A word for the weather, for accessibility labels and quiet captions. */
export function describe(w: Weather): string {
  if (w.storm > 0.35) return 'Thunderstorm';
  if (w.rain > 0.6) return 'Heavy rain';
  if (w.rain > 0.25) return 'Rain';
  if (w.rain > 0.06) return 'Drizzle';
  if (w.fog > 0.35) return 'Mist';
  const windy = w.wind > 0.7 ? 'Windy, ' : '';
  if (w.cloud > 0.75) return `${windy}overcast`.replace(/^./, (c) => c.toUpperCase());
  if (w.cloud > 0.4) return `${windy}cloudy`.replace(/^./, (c) => c.toUpperCase());
  return `${windy}clear`.replace(/^./, (c) => c.toUpperCase());
}
