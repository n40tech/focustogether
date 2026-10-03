import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.'
  );
}

export const supabase = createClient(url, key, {
  auth: {
    // On web, supabase-js uses localStorage itself, and falls back to memory while
    // the static export renders pages in Node (where there is no window).
    ...(Platform.OS !== 'web' && { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// On native, only refresh the auth token while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** The signed-in user's access token, kept to hand for calls that can't wait (see src/lib/away). */
let token: string | null = null;
supabase.auth.onAuthStateChange((_event, session) => {
  token = session?.access_token ?? null;
});
export const accessToken = () => token;

/**
 * Calls an RPC with `fetch(..., { keepalive: true })`, which the browser
 * finishes even as the page is hidden or closed. Fire and forget.
 */
export function rpcKeepalive(fn: string, args: Record<string, unknown>) {
  if (!token) return Promise.resolve();
  return fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    keepalive: true,
    headers: { apikey: key!, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  }).catch(() => {});
}

// Accounts are username-based in the UI; Supabase auth needs an email.
export const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@focus.test`;
