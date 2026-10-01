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
  | 'paper'; // a trade offer

export type SoundSettings = { muted: boolean; volume: number };

export interface AudioEngine {
  /** False until the browser lets the page make sound (after the first tap). */
  readonly unlocked: boolean;
  setAmbience(ambience: Ambience): void;
  /** Quiet crackle while your cigarette lasts. */
  setSmoking(on: boolean): void;
  play(sfx: Sfx, options?: { count?: number }): void;
  setSettings(settings: SoundSettings): void;
  /** Notified when `unlocked` changes. */
  subscribe(listener: () => void): () => void;
}
