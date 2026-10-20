import { Platform } from 'react-native';

import { api } from './api';
import { phoneToAddTo } from './homeScreen';

/**
 * Notifications by web push, even with Focus Together closed: this device
 * subscribes with the browser's push service, and the server sends to it
 * (supabase/functions/push). public/sw.js shows them.
 */

const KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

export type PushState = 'on' | 'off' | 'blocked' | 'home screen' | 'unsupported';

const supported = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  !!KEY &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

async function subscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

const save = (sub: PushSubscription) => {
  const { keys } = sub.toJSON();
  return api.savePush(sub.endpoint, keys?.p256dh ?? '', keys?.auth ?? '');
};

/** The key as the browser wants it: bytes, from URL-safe base64. */
const bytes = (base64url: string) =>
  Uint8Array.from(atob(base64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function pushState(): Promise<PushState> {
  // On an iPhone, web push only works in the home-screen app.
  if (phoneToAddTo() === 'iphone') return 'home screen';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && (await subscription()) ? 'on' : 'off';
}

/** Asks for permission (it has to be from a tap), then subscribes this device for you. */
export async function turnOn(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== 'granted') return pushState();
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytes(KEY!),
    }));
  await save(sub);
  return 'on';
}

/** No more notifications on this device (also when you log out). */
export async function turnOff(): Promise<PushState> {
  if (!supported()) return pushState();
  const sub = await subscription();
  if (sub) {
    await api.dropPush(sub.endpoint).catch(() => {});
    await sub.unsubscribe();
  }
  return pushState();
}

/** Notifications already on here: make sure they're for whoever is signed in now. */
export async function keepPushFresh() {
  if (!supported() || Notification.permission !== 'granted') return;
  const sub = await subscription();
  if (sub) await save(sub);
}
