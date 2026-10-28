import type { Session } from '@supabase/supabase-js';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { pendingInvite } from '@/lib/invites';
import { supabase } from '@/lib/supabase';
import { BACKDROP } from '@/lib/theme';

// An invite link's code, read from the address before the router rewrites it
// (a signed-in player at /login is sent on to the car park).
pendingInvite();

/**
 * The name in the browser tab. It's in both branches below because the web
 * build only renders the loading one: it can't check anyone's sign-in.
 */
function PageTitle() {
  return (
    <Head>
      <title>Focus Together</title>
    </Head>
  );
}

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: BACKDROP,
        }}
      >
        <PageTitle />
        <ActivityIndicator color="#e8e3d7" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <PageTitle />
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BACKDROP } }}>
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
    </SafeAreaProvider>
  );
}
