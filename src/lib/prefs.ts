import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';

/** Settings kept on this device (sound has its own, in src/audio/sound). */
export type Prefs = {
  /** See your friends' friends about the place, see-through. */
  friendsOfFriends: boolean;
};

const KEY = 'focus.prefs';

let prefs: Prefs = { friendsOfFriends: true };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

let loading: Promise<void> | null = null;
function load() {
  loading ??= AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw) prefs = { ...prefs, ...(JSON.parse(raw) as Partial<Prefs>) };
    })
    .catch(() => {})
    .finally(emit);
  return loading;
}

export function setPrefs(next: Partial<Prefs>) {
  prefs = { ...prefs, ...next };
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function usePrefs() {
  useEffect(() => {
    load();
  }, []);
  return useSyncExternalStore(
    subscribe,
    () => prefs,
    () => prefs
  );
}
