import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, type Href } from 'expo-router';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { playSound, type Sfx } from '@/audio/sound';
import { Button } from '@/components/Button';
import { usePolled } from '@/hooks/usePolled';
import { api, type Friend, type FriendOfFriend, type Me } from '@/lib/api';
import { fetchMe, startAwayWatch, watchSession } from '@/lib/away';
import { defaultLooks, paint, type Looks } from '@/lib/looks';
import { usePrefs } from '@/lib/prefs';
import { keepPushFresh } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { tones } from '@/lib/theme';

/** You: your status, breaks and sessions. */
const POLL_MS = 10_000;
/**
 * Friends and their friends change more slowly, and where they are out in
 * the car park or the garden comes over Realtime, so these can wait longer.
 */
const FRIENDS_POLL_MS = 20_000;
/** Looks change rarely, and yours update at once. */
const LOOKS_POLL_MS = 60_000;

type World = {
  me: Me;
  friends: Friend[];
  /** Friends of your friends who are at work. */
  friendsOfFriends: FriendOfFriend[];
  /** Looks chosen by you, your friends and theirs, by username. */
  looks: Record<string, Looks>;
  setLooks: (looks: Record<string, Looks>) => void;
  /** Friends of friends you've tapped on, so you know their names (on this page). */
  revealed: string[];
  reveal: (username: string) => void;
  setMe: (me: Me) => void;
  /** Re-fetches you and your friends. */
  refresh: () => Promise<void>;
};

const WorldContext = createContext<World | null>(null);
const NOBODY: FriendOfFriend[] = [];

export function useWorld() {
  const world = use(WorldContext);
  if (!world) throw new Error('useWorld must be used inside <WorldProvider>');
  return world;
}

/** Polls the server for you and your friends; renders children once you've loaded. */
export function WorldProvider({ children }: { children: ReactNode }) {
  const me = usePolled(fetchMe, POLL_MS);
  const board = usePolled(api.getFriendsBoard, FRIENDS_POLL_MS);
  const others = usePolled(api.getFriendsOfFriends, FRIENDS_POLL_MS);
  const looks = usePolled(api.getLooks, LOOKS_POLL_MS);
  // Friends of friends can be hidden in settings.
  const { friendsOfFriends: showOthers } = usePrefs();

  // Leaving the page mid-session stops the session (see src/lib/away).
  useEffect(startAwayWatch, []);
  // Notifications on this device go to whoever is signed in now.
  useEffect(() => {
    keepPushFresh().catch(() => {});
  }, []);
  const session = me.data?.active_session ?? null;
  useEffect(() => watchSession(session), [session]);

  const refreshMe = me.refresh;
  const refreshBoard = board.refresh;
  const refreshOthers = others.refresh;
  const refresh = useCallback(async () => {
    await Promise.all([refreshMe(), refreshBoard(), refreshOthers()]);
  }, [refreshMe, refreshBoard, refreshOthers]);

  const [revealed, setRevealed] = useState<string[]>([]);
  const reveal = useCallback(
    (username: string) => setRevealed((r) => (r.includes(username) ? r : [...r, username])),
    []
  );

  const value = useMemo(
    () =>
      me.data
        ? {
            me: me.data,
            friends: board.data ?? [],
            friendsOfFriends: showOthers ? (others.data ?? NOBODY) : NOBODY,
            looks: looks.data ?? {},
            setLooks: looks.setData,
            revealed,
            reveal,
            setMe: me.setData,
            refresh,
          }
        : null,
    [
      me.data,
      me.setData,
      board.data,
      others.data,
      showOthers,
      looks.data,
      looks.setData,
      revealed,
      reveal,
      refresh,
    ]
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

/**
 * What to call someone: their name, or, for a friend of a friend you haven't
 * tapped on yet, "Alice's friend".
 */
export function nameFor(
  person: { username: string; display_name: string; via?: string[] },
  revealed: string[]
) {
  return person.via && !revealed.includes(person.username)
    ? `${person.via[0] ?? 'A friend'}'s friend`
    : person.display_name;
}

/** How someone looks: as they chose, or picked from their username. */
export function useLooksOf(username: string): Looks {
  return use(WorldContext)?.looks[username] ?? defaultLooks(username);
}

/** The colours to draw someone in. */
export const usePaintOf = (username: string) => paint(useLooksOf(username));

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
