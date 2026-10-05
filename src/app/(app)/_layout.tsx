import { Stack, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { BetaBanner } from '@/components/BetaBanner';
import { TestPanel } from '@/components/TestPanel';
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
  return (
    <View style={styles.fill}>
      {/* Not in the office, which is for studying. Every session runs there,
          and on a phone, opening WhatsApp mid-session would stop it. */}
      {pathname !== '/office' && <BetaBanner />}
      <View style={styles.fill}>
        <Places />
      </View>
      <TestPanel />
    </View>
  );
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
        contentStyle: { backgroundColor: '#7d7a73' },
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
