import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { engine } from './engine';
import type { Ambience, Sfx, SfxOptions, SoundSettings } from './types';

export type { Ambience, Sfx } from './types';

const KEY = 'focus.sound';

let settings: SoundSettings = { muted: false, volume: 0.8 };
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
      if (raw) settings = { ...settings, ...(JSON.parse(raw) as Partial<SoundSettings>) };
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
