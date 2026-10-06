/**
 * The web sound engine: every sound is synthesised with the Web Audio API, so
 * there are no audio files yet. Continuous layers (rain, wind, room tone…) are
 * steered by the shared weather every tick, and short events (drops, birds,
 * chimes, thunder…) are scheduled a little ahead of time.
 *
 *   outside sounds ─▶ window (low-pass, closed indoors) ─┐
 *   inside sounds ───────────────────────────────────────┼─▶ master ─▶ speakers
 *   one-shots ───────────────────────────────────────────┘
 */
import { serverNow } from '@/lib/clock';
import { conditionsAt } from '@/weather/conditions';
import { gustAt, smoothstep, strikeDistance, strikesBetween } from '@/weather/weather';

import { loopingNoise, type NoiseColour } from './noise';
import type { Ambience, AudioEngine, Sfx, SfxOptions, SoundSettings } from './types';

/** How each place mixes the layers. `window` is the cutoff (Hz) for outside sounds. */
type Mix = {
  window: number;
  outside: number;
  rain: number;
  drops: number;
  wind: number;
  birds: number;
  crickets: number;
  chimes: number;
  traffic: number;
  room: number;
  glass: number;
};

// prettier-ignore
const MIXES: Record<Ambience, Mix> = {
  carpark: { window: 16000, outside: 1, rain: 1, drops: 1, wind: 1, birds: 0.6, crickets: 0.7, chimes: 0, traffic: 1, room: 0, glass: 0 },
  office: { window: 700, outside: 0.9, rain: 1, drops: 0.4, wind: 0.8, birds: 0.5, crickets: 0.4, chimes: 0, traffic: 0.5, room: 1, glass: 1 },
  garden: { window: 16000, outside: 1, rain: 1, drops: 1, wind: 1, birds: 1, crickets: 1, chimes: 1, traffic: 0.15, room: 0, glass: 0 },
  indoors: { window: 900, outside: 0.75, rain: 1, drops: 0.4, wind: 0.8, birds: 0.4, crickets: 0.3, chimes: 0, traffic: 0.4, room: 0.7, glass: 0.6 },
  quiet: { window: 2200, outside: 0.5, rain: 1, drops: 0.5, wind: 0.7, birds: 0.4, crickets: 0.4, chimes: 0.3, traffic: 0.2, room: 0, glass: 0 },
};

const TICK_MS = 200;
/** Events are scheduled this far ahead (s), so timer jitter never gaps the sound. */
const LOOKAHEAD = 0.5;
/** Time constant (s) for crossfading between places: settled in ~3 s. */
const SCENE_FADE = 0.9;

const PENTATONIC = [1046.5, 1174.7, 1318.5, 1568, 1760];

/** Brings the quiet, layered mix up to a comfortable level; the limiter catches peaks. */
const MAKEUP_GAIN = 3.2;

type Nodes = {
  master: GainNode;
  outside: GainNode;
  /** The "window": a low-pass on everything outside, closed indoors. */
  muffle: BiquadFilterNode;
  inside: GainNode;
  sfx: GainNode;
  rain: GainNode;
  rainTone: BiquadFilterNode;
  drops: GainNode;
  wind: GainNode;
  windTone: BiquadFilterNode;
  whistle: GainNode;
  whistleTone: BiquadFilterNode;
  thunder: GainNode;
  birds: GainNode;
  crickets: GainNode;
  cricketVoices: { gate: GainNode; period: number; nextAt: number }[];
  chimes: GainNode;
  traffic: GainNode;
  cars: GainNode;
  room: GainNode;
  glass: GainNode;
};

/**
 * iPhones and iPads mute web audio while the ring/silent switch is on silent,
 * as they do a game's sound effects. Focus is mostly sound, so it asks to be
 * treated as playback instead (like a video): it plays on silent too, and,
 * like a video, pauses music from other apps while it does. Muting Focus
 * gives the phone's sound back.
 *
 * Safari's Audio Session API says so directly; older iOS needs an audio
 * element playing (a silent loop) to switch the page over.
 */
const silentSwitch = (() => {
  type Session = { type: string };
  let loop: HTMLAudioElement | null = null;
  const apple = () =>
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
  const session = () => (navigator as Navigator & { audioSession?: Session }).audioSession ?? null;

  /** A quarter of a second of silence, as a WAV file. */
  function silence() {
    const samples = 2000;
    const bytes = new DataView(new ArrayBuffer(44 + samples));
    const text = (at: number, s: string) =>
      [...s].forEach((c, i) => bytes.setUint8(at + i, c.charCodeAt(0)));
    text(0, 'RIFF');
    bytes.setUint32(4, 36 + samples, true);
    text(8, 'WAVEfmt ');
    bytes.setUint32(16, 16, true);
    bytes.setUint16(20, 1, true); // PCM
    bytes.setUint16(22, 1, true); // mono
    bytes.setUint32(24, 8000, true);
    bytes.setUint32(28, 8000, true);
    bytes.setUint16(32, 1, true);
    bytes.setUint16(34, 8, true);
    text(36, 'data');
    bytes.setUint32(40, samples, true);
    for (let i = 0; i < samples; i++) bytes.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([bytes.buffer], { type: 'audio/wav' }));
  }

  return {
    claim() {
      try {
        const s = session();
        if (s) {
          if (s.type !== 'playback') s.type = 'playback';
          return;
        }
        if (!apple()) return;
        if (!loop) {
          loop = document.createElement('audio');
          loop.setAttribute('x-webkit-airplay', 'deny');
          loop.preload = 'auto';
          loop.loop = true;
          loop.src = silence();
        }
        if (loop.paused) loop.play().catch(() => {});
      } catch {
        // Not allowed yet: the next tap tries again.
      }
    },
    release() {
      try {
        const s = session();
        if (s && s.type !== 'auto') s.type = 'auto';
        loop?.pause();
      } catch {
        // Nothing to give back.
      }
    },
  };
})();

class WebAudioEngine implements AudioEngine {
  unlocked = false;
  onBeforeTap = false;

  private ctx: AudioContext | null = null;
  private n: Nodes | null = null;
  private noise: Record<NoiseColour, AudioBuffer> | null = null;
  private ambience: Ambience = 'quiet';
  private settings: SoundSettings = { muted: false, volume: 0.8 };
  private smoking = false;
  private listeners = new Set<() => void>();
  private scheduledUntil = 0;
  private strikesUntil = 0;
  private targets = new WeakMap<AudioParam, number>();

  constructor() {
    if (typeof window === 'undefined') return; // static rendering in Node
    const unlock = (event: Event) => {
      // A tap or key press is starting. These listeners hear it before
      // anything else on the page, so this is how things were beforehand.
      if (event.type === 'pointerdown' || event.type === 'keydown')
        this.onBeforeTap = this.unlocked;
      this.unlock();
    };
    // Browsers only let a page start sound from a tap, click or key press, and
    // phones count the end of a tap (touchend, pointerup), not its start.
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
    // Phones suspend the sound while the page is hidden; pick up again on return.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        silentSwitch.release();
        return;
      }
      if (!this.settings.muted && this.unlocked) silentSwitch.claim();
      if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    });
  }

  // --- public API -----------------------------------------------------------

  setAmbience(ambience: Ambience) {
    this.ambience = ambience;
    if (this.n) this.tick();
  }

  setSmoking(on: boolean) {
    this.smoking = on;
  }

  setSettings(settings: SoundSettings) {
    this.settings = settings;
    // Muted, Focus lets go of the phone's sound, so your own music can play.
    if (settings.muted) silentSwitch.release();
    else if (this.unlocked) silentSwitch.claim();
    this.applyVolume(0.15);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play(sfx: Sfx, options?: SfxOptions) {
    const ctx = this.ctx;
    if (!ctx || !this.n || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    switch (sfx) {
      case 'door':
        return this.door(t);
      case 'bell':
        return this.bell(t);
      case 'chime':
        return this.chime(t);
      case 'chips':
        return this.chips(t, options?.count ?? 5);
      case 'coin':
        return this.coin(t);
      case 'lighter':
        return this.lighter(t);
      case 'water':
        return this.water(t);
      case 'pluck':
        return this.pluck(t);
      case 'munch':
        return this.munch(t);
      case 'pop':
        return this.pop(t);
      case 'bin':
        return this.bin(t);
      case 'paper':
        return this.paper(t);
      case 'rustle':
        return this.rustle(t);
      case 'rift':
        return this.rift(t);
      case 'step':
        return this.step(t, options?.gain ?? 1, options?.pan ?? 0);
      case 'gravel':
        return this.gravelStep(t, options?.gain ?? 1, options?.pan ?? 0);
    }
  }

  // --- lifecycle ------------------------------------------------------------

  private unlock() {
    if (!this.settings.muted) silentSwitch.claim();
    if (this.ctx?.state === 'running') return;
    try {
      if (!this.ctx) {
        const Context =
          window.AudioContext ??
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return; // no Web Audio here; stay silent
        this.ctx = new Context();
      }
      if (!this.n) this.build(this.ctx);
    } catch {
      return;
    }
    const ctx = this.ctx;
    ctx
      .resume()
      .then(() => {
        if (this.unlocked) return;
        this.unlocked = true;
        this.scheduledUntil = ctx.currentTime;
        this.strikesUntil = serverNow();
        this.tick();
        this.applyVolume(1.5); // fade in rather than start with a burst
        setInterval(() => this.tick(), TICK_MS);
        this.listeners.forEach((l) => l());
      })
      .catch(() => {});
  }

  private applyVolume(timeConstant: number) {
    if (!this.ctx || !this.n) return;
    const { muted, volume } = this.settings;
    const level = this.unlocked && !muted ? volume * volume * MAKEUP_GAIN : 0;
    this.n.master.gain.setTargetAtTime(level, this.ctx.currentTime, timeConstant / 3);
  }

  private build(ctx: AudioContext) {
    const buffer = (colour: NoiseColour, seconds: number) => {
      const length = Math.floor(ctx.sampleRate * seconds);
      const b = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let c = 0; c < 2; c++) b.copyToChannel(loopingNoise(colour, length), c);
      return b;
    };
    this.noise = { white: buffer('white', 2), pink: buffer('pink', 6), brown: buffer('brown', 8) };

    const gain = (value = 0) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    const filter = (type: BiquadFilterType, frequency: number, Q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = Q;
      return f;
    };
    const loop = (colour: NoiseColour, ...chain: AudioNode[]) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise![colour];
      src.loop = true;
      let last: AudioNode = src;
      for (const node of chain) last = last.connect(node);
      src.start(0, Math.random() * src.buffer.duration);
    };

    // A gentle limiter so a thunderclap plus a one-shot can never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const master = gain(0);
    master.connect(limiter);
    const muffle = filter('lowpass', 16000);
    const outside = gain(1);
    outside.connect(muffle).connect(master);
    const inside = gain(1);
    inside.connect(master);
    const sfx = gain(1);
    sfx.connect(master);

    const bus = (into: AudioNode) => {
      const g = gain(0);
      g.connect(into);
      return g;
    };

    // Rain: pink noise with the lows cut; brighter and louder as it gets heavier.
    const rain = bus(outside);
    const rainTone = filter('lowpass', 3000);
    loop('pink', filter('highpass', 350), rainTone, rain);

    // Wind: brown noise through a band that rises with each gust, plus a whistle in gales.
    const wind = bus(outside);
    const windTone = filter('bandpass', 300, 0.8);
    loop('brown', windTone, wind);
    const whistle = bus(outside);
    const whistleTone = filter('bandpass', 800, 9);
    loop('white', whistleTone, whistle);

    // Distant traffic: a low rumble that slowly swells.
    const traffic = bus(outside);
    loop('brown', filter('lowpass', 260), traffic);

    // Office room tone: ventilation and air.
    const room = bus(inside);
    loop('brown', filter('lowpass', 160), room);
    const air = gain(0.15);
    air.connect(room);
    loop('pink', filter('lowpass', 900), air);

    // Crickets: always-on tones, gated into chirps by the scheduler.
    const crickets = bus(outside);
    const cricketVoices = [
      { freq: 4280, pan: -0.6, period: 0.82 },
      { freq: 4710, pan: 0.5, period: 1.07 },
      { freq: 4490, pan: 0.1, period: 0.93 },
    ].map(({ freq, pan, period }) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      const gate = gain(0);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      osc.connect(gate).connect(panner).connect(crickets);
      osc.start();
      return { gate, period, nextAt: 0 };
    });

    this.n = {
      master,
      outside,
      muffle,
      inside,
      sfx,
      rain,
      rainTone,
      drops: bus(outside),
      wind,
      windTone,
      whistle,
      whistleTone,
      thunder: bus(outside),
      birds: bus(outside),
      crickets,
      cricketVoices,
      chimes: bus(outside),
      traffic,
      cars: bus(outside),
      room,
      glass: bus(inside),
    };
  }

  // --- the tick: steer layers, schedule events -------------------------------

  /** Glides a parameter towards `value`, skipping no-op updates. */
  private glide(param: AudioParam, value: number, timeConstant: number) {
    const last = this.targets.get(param);
    if (last !== undefined && Math.abs(last - value) <= Math.abs(value) * 0.002 + 1e-5) return;
    this.targets.set(param, value);
    param.setTargetAtTime(value, this.ctx!.currentTime, timeConstant);
  }

  private tick() {
    const ctx = this.ctx;
    const n = this.n;
    if (!ctx || !n || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    const ms = serverNow();
    const { weather: w, light } = conditionsAt(ms);
    const gust = gustAt(ms, w.wind);
    const mix = MIXES[this.ambience];
    const dark = 1 - light.daylight;

    this.glide(n.muffle.frequency, mix.window, SCENE_FADE);
    this.glide(n.outside.gain, mix.outside, SCENE_FADE);
    this.glide(n.rain.gain, mix.rain * 0.3 * w.rain ** 0.8, 1.5);
    this.glide(n.rainTone.frequency, 1800 + 6500 * w.rain, 1.5);
    this.glide(n.wind.gain, mix.wind * (0.035 + 0.22 * gust ** 1.5), 0.6);
    this.glide(n.windTone.frequency, 180 + 650 * gust, 0.6);
    this.glide(n.whistle.gain, mix.wind * 0.03 * smoothstep(0.55, 1, gust), 0.6);
    this.glide(n.whistleTone.frequency, 520 + 900 * gust, 0.8);
    this.glide(n.traffic.gain, mix.traffic * 0.05 * (0.75 + 0.25 * Math.sin(now / 11)), 2);
    this.glide(n.room.gain, mix.room * 0.06, SCENE_FADE);
    this.glide(
      n.crickets.gain,
      mix.crickets * 0.05 * dark * (1 - smoothstep(0.02, 0.25, w.rain)) * (1 - 0.5 * w.wind),
      SCENE_FADE
    );
    for (const [bus, level] of [
      [n.drops, mix.drops],
      [n.glass, mix.glass],
      [n.birds, mix.birds],
      [n.chimes, mix.chimes],
      [n.cars, mix.traffic],
      [n.thunder, 1],
    ] as const) {
      this.glide(bus.gain, level, SCENE_FADE);
    }

    const from = Math.max(this.scheduledUntil, now);
    const to = now + LOOKAHEAD;
    if (to > from) {
      if (w.rain > 0.02) {
        this.every(3 + 14 * w.rain, from, to, (t) => this.drop(t, 0.04 + 0.08 * Math.random()));
        if (mix.glass > 0) this.every(1 + 9 * w.rain, from, to, (t) => this.glassTap(t));
      }
      const birdiness = light.daylight * (1 - smoothstep(0.05, 0.4, w.rain)) * (1 - 0.6 * w.wind);
      if (birdiness > 0.02) this.every(0.45 * birdiness, from, to, (t) => this.birdPhrase(t));
      if (dark > 0.05) this.scheduleCrickets(from, to);
      if (mix.chimes > 0 && gust > 0.35) {
        this.every(1.5 * (gust - 0.35) ** 1.3, from, to, (t) => this.windChime(t));
      }
      if (mix.traffic > 0) this.every(1 / 25, from, to, (t) => this.passingCar(t));
      if (this.smoking) this.every(1.2, from, to, (t) => this.crackle(t));
      this.scheduledUntil = to;
    }

    // Thunder follows the shared strikes, later the further away they are.
    const untilMs = ms + LOOKAHEAD * 1000;
    if (this.strikesUntil < ms - 5000) this.strikesUntil = ms; // woke from a throttled tab
    const stormAt = (t: number) => conditionsAt(t).weather.storm;
    for (const at of strikesBetween(this.strikesUntil, untilMs, stormAt)) {
      this.thunderClap(now + (at - ms) / 1000, strikeDistance(at));
    }
    this.strikesUntil = untilMs;
  }

  /** Calls `fn` at random times in [from, to) at `rate` per second on average. */
  private every(rate: number, from: number, to: number, fn: (t: number) => void) {
    if (rate <= 0) return;
    for (
      let t = from - Math.log(1 - Math.random()) / rate;
      t < to;
      t -= Math.log(1 - Math.random()) / rate
    ) {
      fn(t);
    }
  }

  // --- voices ---------------------------------------------------------------

  private source(colour: NoiseColour) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise![colour];
    return src;
  }

  private gainNode(value = 0) {
    const g = this.ctx!.createGain();
    g.gain.value = value;
    return g;
  }

  private filterNode(type: BiquadFilterType, frequency: number, Q = 0.7) {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  }

  private panner(pan: number) {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  /** A short filtered noise burst: the building block of drops, taps and crunches. */
  private burst(
    t: number,
    into: AudioNode,
    {
      colour = 'white',
      type = 'bandpass',
      freq,
      Q = 1,
      level,
      decay,
      pan = 0,
    }: {
      colour?: NoiseColour;
      type?: BiquadFilterType;
      freq: number;
      Q?: number;
      level: number;
      decay: number;
      pan?: number;
    }
  ) {
    const src = this.source(colour);
    const env = this.gainNode();
    src
      .connect(this.filterNode(type, freq, Q))
      .connect(env)
      .connect(this.panner(pan))
      .connect(into);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.start(t, Math.random() * (src.buffer!.duration - decay - 0.1));
    src.stop(t + decay + 0.05);
  }

  /** A sine tone with an exponential decay (and optional pitch glide). */
  private tone(
    t: number,
    into: AudioNode,
    {
      freq,
      to,
      type = 'sine',
      level,
      attack = 0.005,
      decay,
      pan = 0,
    }: {
      freq: number;
      to?: number;
      type?: OscillatorType;
      level: number;
      attack?: number;
      decay: number;
      pan?: number;
    }
  ) {
    const osc = this.ctx!.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + Math.min(decay, 0.3));
    const env = this.gainNode();
    osc.connect(env).connect(this.panner(pan)).connect(into);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  private drop(t: number, level: number) {
    this.burst(t, this.n!.drops, {
      freq: 1800 + Math.random() * 3600,
      Q: 2 + Math.random() * 4,
      level,
      decay: 0.03 + Math.random() * 0.05,
      pan: Math.random() * 2 - 1,
    });
  }

  private glassTap(t: number) {
    this.burst(t, this.n!.glass, {
      freq: 2600 + Math.random() * 2400,
      Q: 9 + Math.random() * 6,
      level: 0.12 + Math.random() * 0.12,
      decay: 0.015 + Math.random() * 0.02,
      pan: Math.random() - 0.5,
    });
  }

  private birdPhrase(t: number) {
    const species = Math.floor(Math.random() * 3); // 0 rising, 1 trill, 2 warble
    const base = 2300 + Math.random() * 2200;
    const pan = Math.random() * 1.6 - 0.8;
    const level = 0.02 + Math.random() * 0.03;
    const notes =
      species === 1 ? 6 + Math.floor(Math.random() * 6) : 2 + Math.floor(Math.random() * 4);
    let at = t;
    for (let i = 0; i < notes; i++) {
      const length = species === 1 ? 0.03 : 0.06 + Math.random() * 0.08;
      const freq = base * (species === 2 ? 1 + 0.25 * Math.sin(i * 1.7) : 1 + Math.random() * 0.12);
      const glideTo =
        freq * (species === 0 ? 1.25 : species === 1 ? 0.92 : 0.8 + Math.random() * 0.5);
      this.tone(at, this.n!.birds, { freq, to: glideTo, level, attack: 0.008, decay: length, pan });
      at += length + (species === 1 ? 0.02 : 0.05 + Math.random() * 0.1);
    }
  }

  private scheduleCrickets(from: number, to: number) {
    for (const voice of this.n!.cricketVoices) {
      if (voice.nextAt < from) voice.nextAt = from + Math.random() * voice.period;
      while (voice.nextAt < to) {
        // Each chirp is three quick pulses.
        for (let k = 0; k < 3; k++) {
          const p = voice.nextAt + k * 0.042;
          voice.gate.gain.setValueAtTime(0, p);
          voice.gate.gain.linearRampToValueAtTime(1, p + 0.004);
          voice.gate.gain.linearRampToValueAtTime(0, p + 0.02);
        }
        voice.nextAt += voice.period * (0.9 + Math.random() * 0.2);
      }
    }
  }

  private windChime(t: number) {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      const at = t + i * (0.08 + Math.random() * 0.15);
      const pan = Math.random() - 0.5;
      const decay = 2.5 + Math.random() * 1.5;
      [1, 2.76, 5.4].forEach((partial, k) => {
        this.tone(at, this.n!.chimes, {
          freq: freq * partial,
          level: 0.02 / (1 + k * 2.5),
          decay: decay / (1 + k),
          pan,
        });
      });
    }
  }

  private passingCar(t: number) {
    const src = this.source('pink');
    const band = this.filterNode('bandpass', 220, 1.4);
    const env = this.gainNode();
    const pan = this.panner(-0.9);
    const dir = Math.random() < 0.5 ? 1 : -1;
    src.connect(band).connect(env).connect(pan).connect(this.n!.cars);
    band.frequency.setValueAtTime(220, t);
    band.frequency.linearRampToValueAtTime(520, t + 3);
    band.frequency.linearRampToValueAtTime(240, t + 6);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05, t + 3);
    env.gain.linearRampToValueAtTime(0, t + 6);
    pan.pan.setValueAtTime(-0.9 * dir, t);
    pan.pan.linearRampToValueAtTime(0.9 * dir, t + 6);
    src.start(t, Math.random() * 2);
    src.stop(t + 6.1);
  }

  /** `distance` 0 (overhead) … 1 (far off): far thunder arrives later, softer and duller. */
  private thunderClap(t: number, distance: number) {
    const at = Math.max(t, this.ctx!.currentTime) + 0.4 + distance * 5;
    const level = 0.32 - distance * 0.2;
    const src = this.source('brown');
    const tone = this.filterNode('lowpass', 900 - distance * 650);
    const env = this.gainNode();
    src.connect(tone).connect(env).connect(this.n!.thunder);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.08 + distance * 0.5);
    let rumble = at + 0.3 + distance * 0.5;
    for (let k = 0; k < 4; k++) {
      env.gain.linearRampToValueAtTime(
        level * (0.4 + Math.random() * 0.6) * (1 - k * 0.18),
        rumble
      );
      rumble += 0.4 + Math.random() * 0.9;
    }
    env.gain.exponentialRampToValueAtTime(0.0001, rumble + 2.5 + distance * 2);
    src.start(at);
    src.stop(rumble + 5);
    if (distance < 0.35) {
      this.burst(at, this.n!.thunder, { type: 'highpass', freq: 1200, level: 0.12, decay: 0.3 });
    }
  }

  private crackle(t: number) {
    this.burst(t, this.n!.sfx, {
      type: 'highpass',
      freq: 2500,
      level: 0.015 + Math.random() * 0.03,
      decay: 0.004 + Math.random() * 0.006,
      pan: Math.random() * 0.4 - 0.2,
    });
  }

  // --- one-shots ------------------------------------------------------------

  private door(t: number) {
    const out = this.n!.sfx;
    this.burst(t, out, { colour: 'brown', type: 'lowpass', freq: 180, level: 0.5, decay: 0.35 });
    this.tone(t + 0.02, out, { freq: 1800, level: 0.03, decay: 0.012 });
  }

  /** Two soft dings: the break is over. */
  private bell(t: number) {
    [784, 659.3].forEach((freq, i) => {
      [1, 2, 2.99, 4.1].forEach((partial, k) => {
        this.tone(t + i * 0.6, this.n!.sfx, {
          freq: freq * partial,
          level: 0.12 / (1 + k * 1.8),
          decay: 2.8 / (1 + k * 0.6),
        });
      });
    });
  }

  /** A gentle rising arpeggio: the session is done. */
  private chime(t: number) {
    [523.3, 659.3, 784].forEach((freq, i) => {
      this.tone(t + i * 0.18, this.n!.sfx, { freq, level: 0.12, decay: 1.4 });
      this.tone(t + i * 0.18, this.n!.sfx, { freq: freq * 4, level: 0.015, decay: 0.4 });
    });
  }

  private chips(t: number, count: number) {
    let at = t;
    for (let i = 0; i < Math.min(count, 24); i++) {
      const freq = 2600 + Math.random() * 1000;
      this.tone(at, this.n!.sfx, { freq, type: 'triangle', level: 0.12, decay: 0.06 });
      this.tone(at, this.n!.sfx, { freq: freq * 1.52, level: 0.05, decay: 0.04 });
      this.burst(at, this.n!.sfx, { type: 'highpass', freq: 4000, level: 0.08, decay: 0.012 });
      at += 0.06 + Math.random() * 0.06;
    }
  }

  private coin(t: number) {
    this.tone(t, this.n!.sfx, { freq: 1568, type: 'triangle', level: 0.14, decay: 0.25 });
    this.tone(t + 0.09, this.n!.sfx, { freq: 2093, type: 'triangle', level: 0.14, decay: 0.4 });
  }

  private lighter(t: number) {
    const out = this.n!.sfx;
    this.burst(t, out, { freq: 3500, Q: 2, level: 0.25, decay: 0.05 });
    const src = this.source('pink');
    const env = this.gainNode();
    src
      .connect(this.filterNode('bandpass', 700, 0.8))
      .connect(env)
      .connect(out);
    env.gain.setValueAtTime(0, t + 0.05);
    env.gain.linearRampToValueAtTime(0.14, t + 0.2);
    env.gain.linearRampToValueAtTime(0, t + 0.6);
    src.start(t + 0.05, Math.random());
    src.stop(t + 0.65);
  }

  private water(t: number) {
    const ctx = this.ctx!;
    const src = this.source('pink');
    const env = this.gainNode();
    const wobble = ctx.createOscillator();
    const depth = this.gainNode(0.06);
    wobble.frequency.value = 7;
    wobble.connect(depth).connect(env.gain);
    src
      .connect(this.filterNode('bandpass', 2000, 1.2))
      .connect(env)
      .connect(this.n!.sfx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.24, t + 0.25);
    env.gain.setValueAtTime(0.24, t + 1.6);
    env.gain.linearRampToValueAtTime(0, t + 2.2);
    src.start(t, Math.random());
    wobble.start(t);
    src.stop(t + 2.3);
    wobble.stop(t + 2.3);
  }

  private pluck(t: number) {
    this.tone(t, this.n!.sfx, { freq: 220, to: 160, type: 'triangle', level: 0.1, decay: 0.15 });
    this.burst(t, this.n!.sfx, {
      colour: 'brown',
      type: 'lowpass',
      freq: 300,
      level: 0.2,
      decay: 0.12,
    });
  }

  private munch(t: number) {
    for (let i = 0; i < 3; i++) {
      this.burst(t + i * 0.2, this.n!.sfx, {
        freq: 1500 + Math.random() * 1000,
        Q: 1.5,
        level: 0.18,
        decay: 0.08,
      });
    }
  }

  private pop(t: number) {
    this.tone(t, this.n!.sfx, { freq: 520, to: 840, level: 0.09, decay: 0.1 });
  }

  /** A rift tearing open: a low rushing swell, and two tones sinking apart. */
  private rift(t: number) {
    const src = this.source('brown');
    const env = this.gainNode();
    src
      .connect(this.filterNode('lowpass', 420, 1.2))
      .connect(env)
      .connect(this.n!.sfx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.32, t + 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    src.start(t, Math.random());
    src.stop(t + 1.7);
    this.tone(t + 0.1, this.n!.sfx, { freq: 220, to: 160, level: 0.07, attack: 0.3, decay: 1.2 });
    this.tone(t + 0.1, this.n!.sfx, { freq: 233, to: 290, level: 0.05, attack: 0.3, decay: 1.2 });
  }

  /** Dry stalks pulled up and dropped on the compost: a papery swish, then a soft thump. */
  private rustle(t: number) {
    const src = this.source('pink');
    const env = this.gainNode();
    src
      .connect(this.filterNode('bandpass', 2400, 0.6))
      .connect(this.filterNode('highpass', 900))
      .connect(env)
      .connect(this.n!.sfx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.16, t + 0.08);
    env.gain.linearRampToValueAtTime(0.05, t + 0.25);
    env.gain.linearRampToValueAtTime(0.12, t + 0.32);
    env.gain.linearRampToValueAtTime(0, t + 0.6);
    src.start(t, Math.random());
    src.stop(t + 0.65);
    this.burst(t + 0.62, this.n!.sfx, {
      colour: 'brown',
      type: 'lowpass',
      freq: 260,
      level: 0.14,
      decay: 0.16,
    });
  }
  /** A soft footfall on grass: a dull thud and a whisper of blades. */
  private step(t: number, gain: number, pan: number) {
    const sfx = this.n!.sfx;
    const p = pan + (Math.random() - 0.5) * 0.12;
    this.burst(t, sfx, {
      colour: 'pink',
      type: 'lowpass',
      freq: 380 + Math.random() * 220,
      level: 0.11 * gain,
      decay: 0.09,
      pan: p,
    });
    this.burst(t + 0.012, sfx, {
      freq: 2600 + Math.random() * 1600,
      Q: 0.7,
      level: 0.018 * gain,
      decay: 0.07,
      pan: p,
    });
  }
  /** A footfall on gravel: a few tiny stones shifting. */
  private gravelStep(t: number, gain: number, pan: number) {
    const sfx = this.n!.sfx;
    const p = pan + (Math.random() - 0.5) * 0.12;
    this.burst(t, sfx, {
      colour: 'pink',
      type: 'lowpass',
      freq: 650,
      level: 0.06 * gain,
      decay: 0.06,
      pan: p,
    });
    for (let i = 0, at = t; i < 5; i++, at += 0.006 + Math.random() * 0.014) {
      this.burst(at, sfx, {
        freq: 2200 + Math.random() * 2800,
        Q: 2.2,
        level: (0.025 + Math.random() * 0.03) * gain,
        decay: 0.025,
        pan: p,
      });
    }
  }
  /** Something dropped into a wheelie bin, and the lid let fall. */
  private bin(t: number) {
    const out = this.n!.sfx;
    this.tone(t, out, { freq: 140, to: 70, level: 0.35, decay: 0.22 });
    this.burst(t, out, { colour: 'pink', freq: 700, Q: 1.2, level: 0.25, decay: 0.12 });
    this.tone(t + 0.32, out, { freq: 190, to: 110, level: 0.28, decay: 0.16 });
    this.burst(t + 0.32, out, { freq: 1100, Q: 1.5, level: 0.22, decay: 0.08 });
  }

  private paper(t: number) {
    const src = this.source('pink');
    const env = this.gainNode();
    src
      .connect(this.filterNode('highpass', 1500))
      .connect(this.filterNode('bandpass', 3000, 0.8))
      .connect(env)
      .connect(this.n!.sfx);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.12);
    env.gain.linearRampToValueAtTime(0, t + 0.35);
    src.start(t, Math.random());
    src.stop(t + 0.4);
  }
}

export const engine: AudioEngine = new WebAudioEngine();
