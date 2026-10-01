import { smoothstep, type Weather } from './weather';

export type DayPhase = 'night' | 'dawn' | 'day' | 'golden' | 'dusk';

/**
 * How a scene is lit. Everything is seen from above and in front, so there is
 * no sky: the time of day shows only as a colour cast over the whole scene,
 * and lamps and screens glow through it after dark.
 */
export type Light = {
  /** 0 night … 1 full daylight */
  daylight: number;
  phase: DayPhase;
  /** Laid over the whole scene. */
  tint: { color: string; opacity: number };
  /** 0 … 1: how strongly lamps, lit windows and screens glow. */
  glow: number;
  /** 0 … 1: soft cloud shadows drifting over the ground (broken cloud, daytime). */
  cloudShadows: number;
};

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** Approximates stacking translucent colour layers as a single one. */
function stack(layers: { color: string; opacity: number }[]) {
  const total = layers.reduce((sum, l) => sum + l.opacity, 0);
  if (total <= 0.001) return { color: '#000000', opacity: 0 };
  const rgb = [0, 1, 2].map((i) =>
    layers.reduce((sum, l) => sum + hex(l.color)[i] * l.opacity, 0) / total
  ) as RGB;
  return { color: toHex(rgb), opacity: Math.min(0.72, 1 - layers.reduce((p, l) => p * (1 - l.opacity), 1)) };
}

/**
 * Sunrise and sunset in local clock hours, roughly for Bristol (51.5° N):
 * about 16½ hours of daylight at midsummer, 8 at midwinter.
 */
function sunTimes(date: Date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - start.getTime()) / 86_400_000;
  const length = 12.2 + 4.3 * Math.cos((2 * Math.PI * (dayOfYear - 172)) / 365.25);
  // Solar noon is ~12:10 on GMT and an hour later in summer time.
  const summerTime = date.getTimezoneOffset() < start.getTimezoneOffset();
  const noon = 12.17 + (summerTime ? 1 : 0);
  return { sunrise: noon - length / 2, sunset: noon + length / 2 };
}

/** `ms` is read in the player's local time zone. */
export function lightAt(ms: number, w: Weather): Light {
  const date = new Date(ms);
  const h = date.getHours() + date.getMinutes() / 60;
  const { sunrise, sunset } = sunTimes(date);

  const daylight =
    smoothstep(sunrise - 0.6, sunrise + 0.6, h) * (1 - smoothstep(sunset - 0.6, sunset + 0.6, h));
  const twilight = 4 * daylight * (1 - daylight);
  const morning = daylight * (1 - smoothstep(sunrise + 0.4, sunrise + 1.8, h)) * (h < 12 ? 1 : 0);
  const golden = daylight * smoothstep(sunset - 2.2, sunset - 0.8, h) * (h > 12 ? 1 : 0);
  // Low sun and cloud mute each other.
  const clearness = 1 - w.cloud * 0.7;

  const tint = stack([
    { color: '#0c1533', opacity: 0.55 * (1 - daylight) }, // night: deep blue
    { color: '#4a3a78', opacity: 0.3 * twilight }, // blue hour: violet
    { color: '#ee9f96', opacity: 0.16 * morning * clearness }, // dawn: rose
    { color: '#f0a03c', opacity: 0.16 * golden * clearness }, // golden hour: amber
    { color: '#56626e', opacity: 0.16 * w.cloud * daylight }, // overcast: cool grey
    { color: '#1b2633', opacity: 0.12 * w.rain + 0.12 * w.storm }, // rain: darker
  ]);

  const phase: DayPhase =
    daylight < 0.06 ? 'night'
      : daylight < 0.94 ? (h < 12 ? 'dawn' : 'dusk')
        : golden > 0.4 ? 'golden' : 'day';

  return {
    daylight,
    phase,
    tint,
    glow: Math.min(1, (1 - daylight) * 0.9 + w.storm * 0.4 + w.rain * w.cloud * 0.25),
    cloudShadows: daylight * smoothstep(0.12, 0.42, w.cloud) * (1 - smoothstep(0.62, 0.9, w.cloud)),
  };
}
