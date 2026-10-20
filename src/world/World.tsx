import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, type Href } from 'expo-router';
import { createContext, use, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { playSound, type Sfx } from '@/audio/sound';
import { Button } from '@/components/Button';
import { usePolled } from '@/hooks/usePolled';
import { api, type Friend, type FriendOfFriend, type Me } from '@/lib/api';
import { fetchMe, startAwayWatch, watchSession } from '@/lib/away';
import { supabase } from '@/lib/supabase';
import { tones } from '@/lib/theme';

const POLL_MS = 10_000;

type World = {
  me: Me;
  friends: Friend[];
  /** Friends of your friends who are at work. */
  friendsOfFriends: FriendOfFriend[];
  setMe: (me: Me) => void;
  /** Re-fetches you and your friends. */
  refresh: () => Promise<void>;
};

const WorldContext = createContext<World | null>(null);

export function useWorld() {
  const world = use(WorldContext);
  if (!world) throw new Error('useWorld must be used inside <WorldProvider>');
  return world;
}

/** Polls the server for you and your friends; renders children once you've loaded. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const me = usePolled(fetchMe, POLL_MS);
  const board = usePolled(api.getFriendsBoard, POLL_MS);
  const others = usePolled(api.getFriendsOfFriends, POLL_MS);

  // Leaving the page mid-session stops the session (see src/lib/away).
  useEffect(startAwayWatch, []);
  const session = me.data?.active_session ?? null;
  useEffect(() => watchSession(session), [session]);

  const refreshMe = me.refresh;
  const refreshBoard = board.refresh;
  const refreshOthers = others.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshMe(), refreshBoard(), refreshOthers()]);
  }, [refreshMe, refreshBoard, refreshOthers]);

  const value = useMemo(
    () =>
      me.data
        ? {
            me: me.data,
            friends: board.data ?? [],
            friendsOfFriends: others.data ?? [],
            setMe: me.setData,
            refresh,
          }
        : null,
    [me.data, me.setData, board.data, others.data, refresh]
  );

  if (!value) return <Arriving error={me.error} retry={refreshMe} />;
  return <WorldContext value={value}>{children}</WorldContext>;
}

function Arriving({ error, retry }: { error: string | null; retry: () => void }) {
  const tone = tones.day;
  return (
    <View style={styles.arriving}>
      {error ? (
        <>
          <Text style={[styles.text, { color: tone.text }]}>{error}</Text>
          <Button title="Try again" onPress={retry} />
          <Button title="Log out" variant="ghost" onPress={() => supabase.auth.signOut()} />
        </>
      ) : (
        <>
          <ActivityIndicator color={tone.muted} />
          <Text style={[styles.text, { color: tone.muted }]}>Arriving…</Text>
        </>
      )}
    </View>
  );
}

/** Walks to another place, with a door sound by default. */
export function useGo() {
  const router = useRouter();
  return useCallback(
    (href: Href, sound: Sfx | null = 'door') => {
      if (sound) playSound(sound);
      router.replace(href);
    },
    [router]
  );
}

// The payout screen shows once per completed session, even if the timer ran
// out while the app was closed.
const SEEN_KEY = 'focus.payoutSeen';
let seenPayout: number | null = null;
let seenLoaded: Promise<void> | null = null;

export function loadSeenPayout() {
  seenLoaded ??= AsyncStorage.getItem(SEEN_KEY)
    .then((v) => {
      seenPayout = v ? Number(v) : null;
    })
    .catch(() => {});
  return seenLoaded;
}

export const isPayoutSeen = (sessionId: number) => seenPayout === sessionId;

export function markPayoutSeen(sessionId: number) {
  seenPayout = sessionId;
  AsyncStorage.setItem(SEEN_KEY, String(sessionId)).catch(() => {});
}

const styles = StyleSheet.create({
  arriving: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: '#d9d2c5',
  },
  text: { fontSize: 15, textAlign: 'center' },
});
