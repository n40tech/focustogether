import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

/**
 * Adding Focus Together to a phone's home screen, so it opens like an app.
 * Which phone it is decides the steps; on Android, Chrome may also offer a
 * one-tap install (its `beforeinstallprompt` event), kept here until asked for.
 */

const web = Platform.OS === 'web' && typeof window !== 'undefined';

export type Phone = 'iphone' | 'android';

/** The phone this page is on, or null on a computer or once it's opened from the home screen. */
export function phoneToAddTo(): Phone | null {
  if (!web) return null;
  const standalone =
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (navigator as { standalone?: boolean }).standalone === true;
  if (standalone) return null;
  const ua = navigator.userAgent;
  // An iPad says it's a Mac, but a Mac has no touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))
    return 'iphone';
  if (/Android/.test(ua)) return 'android';
  return null;
}

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let installPrompt: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

if (web) {
  // Chrome fires this soon after the page loads, so listen from the start.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    changed();
  });
}

/** Chrome's install, when it's on offer: resolves true if the player added it. */
export function useInstall(): (() => Promise<boolean>) | null {
  const offered = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => installPrompt,
    () => null
  );
  if (!offered) return null;
  return async () => {
    installPrompt = null;
    changed();
    await offered.prompt();
    return (await offered.userChoice).outcome === 'accepted';
  };
}
