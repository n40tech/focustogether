import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddFriend } from '@/components/AddFriend';
import { Button } from '@/components/Button';
import { PointsBadge } from '@/components/PointsBadge';
import { StatusBoard } from '@/components/StatusBoard';
import { Timer } from '@/components/Timer';
import { usePolled } from '@/hooks/usePolled';
import { useNow } from '@/hooks/useNow';
import { api } from '@/lib/api';
import { cancelSessionEnd } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

const POLL_MS = 10_000;

export default function Dashboard() {
  const me = usePolled(api.getMe, POLL_MS);
  const board = usePolled(api.getFriendsBoard, POLL_MS);
  const [refreshing, setRefreshing] = useState(false);

  const now = useNow();

  const refreshMe = me.refresh;
  const refreshBoard = board.refresh;
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refreshMe(), refreshBoard()]);
    setRefreshing(false);
  }, [refreshMe, refreshBoard]);

  const signOut = async () => {
    await cancelSessionEnd();
    await supabase.auth.signOut();
  };

  if (!me.data) {
    return (
      <SafeAreaView style={styles.center}>
        {me.error ? (
          <>
            <Text style={styles.error}>{me.error}</Text>
            <Button title="Retry" onPress={refreshMe} />
            <Button title="Log out" variant="ghost" onPress={signOut} />
          </>
        ) : (
          <ActivityIndicator />
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshAll} />}
      >
        <View style={styles.header}>
          <Text style={styles.hello}>Hi, {me.data.display_name}</Text>
          <PointsBadge points={me.data.points} />
          <Button title="Log out" variant="ghost" onPress={signOut} />
        </View>

        <Timer me={me.data} now={now} onMeChange={me.setData} refresh={refreshMe} />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Friends</Text>
        </View>
        {board.error && <Text style={styles.error}>{board.error}</Text>}
        {board.data && board.data.length === 0 && (
          <Text style={styles.muted}>No friends yet. Add someone by their username.</Text>
        )}
        {board.data && board.data.length > 0 && <StatusBoard friends={board.data} now={now} />}
        <AddFriend onAdded={refreshBoard} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 20,
    backgroundColor: colors.bg,
  },
  content: { padding: 16, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hello: { fontSize: 22, fontWeight: '800', color: colors.text, flex: 1 },
  sectionHeader: { marginTop: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  muted: { color: colors.muted },
  error: { color: colors.danger, textAlign: 'center' },
});
