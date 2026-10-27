import { Stack, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BetaBanner } from '@/components/BetaBanner';
import { Toast } from '@/components/Chrome';
import { TestPanel } from '@/components/TestPanel';
import { api } from '@/lib/api';
import { pageId } from '@/lib/away';
import { forgetInvite, pendingInvite } from '@/lib/invites';
import { BACKDROP } from '@/lib/theme';
import { isPayoutSeen, loadSeenPayout, useWorld, WorldProvider } from '@/world/World';

export default function AppLayout() {
  return (
    <WorldProvider>
      <World />
    </WorldProvider>
  );
}

function World() {
  const pathname = usePathname();
  const [note, clearNote] = useInviteOnArrival();
  return (
    <View style={styles.fill}>
      {/* Not in the office, which is for studying. Every session runs there,
          and in hard mode on a phone, opening WhatsApp mid-session would stop it. */}
      <BetaBanner hidden={pathname === '/office'}>
        <Places />
      </BetaBanner>
      <TestPanel />
      {note && <Toast key={note} text={note} onDone={clearNote} />}
    </View>
  );
}

/**
 * Came in through an invite link (or joined with a code): you're friends with
 * whoever made it, and if it's to their session, you're studying with them.
 * Says which, once.
 */
function useInviteOnArrival() {
  const { setMe } = useWorld();
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const code = pendingInvite();
    if (!code) return;
    forgetInvite();
    api.openInvite(code, pageId).then(
      (used) => {
        setMe(used.me);
        if (used.joined) {
          router.replace('/office');
          setNote(`You're studying with ${used.from} now, as friends.`);
        } else {
          setNote(`You and ${used.from} are friends now.${used.note ? ` ${used.note}.` : ''}`);
        }
      },
      (e: Error) => setNote(e.message)
    );
  }, [setMe, router]);
  const clear = useCallback(() => setNote(null), []);
  return [note, clear] as const;
}

function Places() {
  const { me } = useWorld();
  const studying = me.status === 'focused';
  usePayoutPrompt();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        gestureEnabled: false,
        contentStyle: { backgroundColor: BACKDROP },
      }}
    >
      {/* While a session runs, the office is the only place that exists: the
          other screens leave the navigator, so links and Back can't reach them. */}
      <Stack.Protected guard={!studying}>
        <Stack.Screen name="index" />
        <Stack.Screen name="payout" />
        <Stack.Screen name="garden" />
        <Stack.Screen name="shop" />
        <Stack.Screen name="friends" />
      </Stack.Protected>
      <Stack.Screen name="office" />
    </Stack>
  );
}

/** Shows the payout once per completed session, even if it ended while you were away. */
function usePayoutPrompt() {
  const { me } = useWorld();
  const router = useRouter();
  const pathname = usePathname();
  const sessionId = me.status === 'on_break' ? me.last_completed?.id : undefined;

  useEffect(() => {
    if (sessionId === undefined || pathname === '/payout') return;
    let cancelled = false;
    loadSeenPayout().then(() => {
      if (!cancelled && !isPayoutSeen(sessionId)) router.replace('/payout');
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, pathname, router]);
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
