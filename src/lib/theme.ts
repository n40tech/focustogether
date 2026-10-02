/**
 * Calm, muted colours. UI panels come in two tones so they never glare: warm
 * paper by day and dim slate after dark (see ToneContext in src/art/Scene).
 */
export const tones = {
  day: {
    panel: 'rgba(248, 244, 236, 0.94)',
    raised: '#fffdf8',
    text: '#2d2b26',
    muted: '#7b766c',
    line: 'rgba(45, 43, 38, 0.12)',
    accent: '#5f7d6a',
    accentText: '#f8f4ec',
    danger: '#a4553f',
    chip: '#9a6b2f',
  },
  night: {
    panel: 'rgba(30, 34, 44, 0.92)',
    raised: '#2a2f3b',
    text: '#e8e3d7',
    muted: '#a29c90',
    line: 'rgba(232, 227, 215, 0.14)',
    accent: '#8fae98',
    accentText: '#1d2027',
    danger: '#d38b74',
    chip: '#d9b06e',
  },
};

export type Tone = (typeof tones)['day'];

/** Placeholder art palettes for each place (top-front view). */
export const palette = {
  carpark: {
    ground: '#6b6f72',
    wet: '#565b60',
    line: '#d8d4cb',
    pavement: '#a8a39a',
    wall: '#c9b8a2',
    roof: '#7c6e65',
    glass: '#93a6af',
    window: '#b7c5cc',
    lit: '#f2d8a2',
    hedge: '#5d7a5a',
    tree: '#6b8a62',
  },
  office: {
    ground: '#c9b9a2',
    wet: '#c9b9a2',
    wall: '#e4dbcd',
    skirting: '#b9ab98',
    window: '#cdd8dc',
    blind: '#efe9df',
    desk: '#b38d66',
    deskTop: '#c7a079',
    monitor: '#3d4147',
    screen: '#5f7686',
    screenOn: '#a9cde0',
    chair: '#5d6571',
    rug: '#b7a78f',
    plant: '#6f8f68',
  },
  garden: {
    ground: '#8ea470',
    wet: '#7a915f',
    path: '#cabea7',
    soil: '#70543f',
    soilWet: '#4e3a2c',
    bed: '#9a7552',
    fence: '#a58b6b',
    hedge: '#5d7a5a',
    shed: '#8a6f5a',
    shedRoof: '#6b5546',
    bench: '#9b7a58',
    butt: '#55606a',
  },
  chips: { white: '#efeae0', red: '#b4574a', green: '#5f8a63', black: '#3b3a3f', edge: '#d9cfb9' },
};

export const font = {
  /** Small caps-ish labels: place names, section titles. */
  label: {
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  body: { fontSize: 15 },
  big: { fontSize: 20, fontWeight: '600' as const },
};
