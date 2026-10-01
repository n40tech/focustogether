import { Platform } from 'react-native';

import { lightAt, type Light } from './light';
import { describe, weatherAt, wetnessAt, type Weather } from './weather';

export type Conditions = {
  weather: Weather;
  light: Light;
  /** 0–1: how wet the ground is, which lags behind the rain. */
  wet: number;
  label: string;
};

const PRESETS: Record<string, Weather> = {
  clear: { cloud: 0.05, rain: 0, wind: 0.2, storm: 0, fog: 0 },
  cloudy: { cloud: 0.6, rain: 0, wind: 0.4, storm: 0, fog: 0 },
  windy: { cloud: 0.45, rain: 0, wind: 0.9, storm: 0, fog: 0 },
  rain: { cloud: 0.95, rain: 0.55, wind: 0.45, storm: 0, fog: 0 },
  storm: { cloud: 1, rain: 0.95, wind: 0.9, storm: 0.9, fog: 0 },
  mist: { cloud: 0.55, rain: 0, wind: 0.05, storm: 0, fog: 0.8 },
};

let cached: { search: string; forced: { weather?: Weather; hour?: number } } | null = null;

/**
 * Preview other weather with `?weather=clear|cloudy|windy|rain|storm|mist` and
 * another time of day with `?hour=0-23`. Web only, and it only changes what
 * you see and hear.
 */
function override() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return {};
  const search = window.location.search;
  if (cached?.search !== search) {
    const params = new URLSearchParams(search);
    const hour = params.get('hour');
    cached = {
      search,
      forced: {
        weather: PRESETS[params.get('weather') ?? ''],
        hour: hour !== null && hour !== '' && !Number.isNaN(Number(hour)) ? Number(hour) : undefined,
      },
    };
  }
  return cached.forced;
}

/** The shared weather and your local light at a (server-corrected) moment. */
export function conditionsAt(ms: number): Conditions {
  const forced = override();
  const local = new Date(ms);
  if (forced.hour !== undefined) local.setHours(forced.hour, 0, 0, 0);
  const hour = local.getHours() + local.getMinutes() / 60;
  const weather = forced.weather ?? weatherAt(ms, hour);
  return {
    weather,
    light: lightAt(local.getTime(), weather),
    wet: forced.weather ? weather.rain : wetnessAt(ms),
    label: describe(weather),
  };
}
