import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { engine } from './engine';
import {
  DEFAULT_SOUND,
  type Ambience,
  type Sfx,
  type SfxOptions,
  type SoundSettings,
} from './types';

export type { Ambience, Sfx, SoundLevels, SoundSettings } from './types';

const KEY = 'focus.sound';

let settings: SoundSettings = DEFAULT_SOUND;
let snapshot = { ...settings, unlocked: engine.unlocked };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { ...settings, unlocked: engine.unlocked };
  listeners.forEach((l) => l());
}
engine.subscribe(emit);

let loading: Promise<void> | null = null;
function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<SoundSettings>;
      // Saved before some setting existed: that one keeps its default.
      settings = { ...settings, ...saved, levels: { ...settings.levels, ...saved.levels } };
    })
    .catch(() => {})
    .finally(() => {
      engine.setSettings(settings);
      emit();
    });
  return loading;
}

export function setSoundSettings(next: Partial<SoundSettings>) {
  settings = { ...settings, ...next };
  engine.setSettings(settings);
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(settings)).catch(() => {});
}

/** Whether sound was already on as this tap began (so it isn't the tap that turns it on). */
export const wasOnBeforeTap = () => engine.onBeforeTap;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Mute / volume, and whether the browser has let us start making sound yet. */
export function useSound() {
  useEffect(() => {
    load();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot
  );
}

/** Plays `ambience` while this screen is focused. */
export function useAmbience(ambience: Ambience) {
  useFocusEffect(
    useCallback(() => {
      engine.setAmbience(ambience);
    }, [ambience])
  );
}

export function playSound(sfx: Sfx, options?: SfxOptions) {
  engine.play(sfx, options);
}

export function setSmoking(on: boolean) {
  engine.setSmoking(on);
}
