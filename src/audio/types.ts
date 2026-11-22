/** The soundscape for the place you're in. */
export type Ambience = 'carpark' | 'office' | 'garden' | 'indoors' | 'quiet';

/** One-shot sounds. */
export type Sfx =
  | 'door' // walking between places
  | 'bell' // break's over
  | 'chime' // session complete
  | 'chips' // chips counted out (pass count)
  | 'coin' // something bought
  | 'lighter' // lighting a cigarette
  | 'water' // watering can
  | 'pluck' // planting or harvesting
  | 'munch' // eating
  | 'pop' // a chat bubble
  | 'paper' // a trade offer
  | 'rustle' // clearing a withered crop
  | 'bin' // throwing something away
  | 'rift' // your two devices pulled you apart
  | 'crunch' // driving into someone's vehicle
  | 'car_door' // getting into or out of your vehicle
  | 'step' // a footstep on grass
  | 'gravel'; // a footstep on the gravel path

/** Footsteps can be someone else's: quieter further off, and to one side. */
export type SfxOptions = { count?: number; gain?: number; pan?: number };

/** The kinds of sound with their own slider in settings, each 0–1. */
export type SoundLevels = {
  /** Rain, drops on the window, wind and thunder. */
  weather: number;
  /** Birds, crickets and wind chimes. */
  nature: number;
  /** Distant traffic and passing cars. */
  traffic: number;
  /** The office's room tone. */
  room: number;
  /** Footsteps, doors, chips and everything else you do. */
  effects: number;
};

export type SoundSettings = {
  muted: boolean;
  /** Overall, 0–1. */
  volume: number;
  levels: SoundLevels;
  /** Carry on playing while you're in another app or tab. */
  keepPlaying: boolean;
};

export const DEFAULT_SOUND: SoundSettings = {
  muted: false,
  volume: 0.8,
  levels: { weather: 1, nature: 1, traffic: 1, room: 1, effects: 1 },
  keepPlaying: true,
};

export interface AudioEngine {
  /**
   * Whether sound is playing: false until the browser lets the page make sound
   * (after the first tap), and again if the phone stopped it while you were
   * away, until a tap starts it again.
   */
  readonly unlocked: boolean;
  /**
   * Whether sound was already on as the latest tap or key press began: false
   * all through the tap that turns it on.
   */
  readonly onBeforeTap: boolean;
  setAmbience(ambience: Ambience): void;
  /** Quiet crackle while your cigarette lasts. */
  setSmoking(on: boolean): void;
  play(sfx: Sfx, options?: SfxOptions): void;
  setSettings(settings: SoundSettings): void;
  /** Notified when `unlocked` changes. */
  subscribe(listener: () => void): () => void;
}
