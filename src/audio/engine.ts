import type { AudioEngine } from './types';

/**
 * iOS / Android: silent for now. The web engine is written against the Web
 * Audio API, so react-native-audio-api (which implements it natively) is the
 * path to sharing it; see docs/PLAN.md.
 */
export const engine: AudioEngine = {
  unlocked: false,
  onBeforeTap: false,
  setAmbience: () => {},
  setSmoking: () => {},
  play: () => {},
  setSettings: () => {},
  subscribe: () => () => {},
};
