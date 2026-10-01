import { StyleSheet, Text, View } from 'react-native';

import type { Friend, Status } from '@/lib/api';
import { colors, statusMeta } from '@/lib/theme';
import { formatMinutes } from '@/lib/time';

const ORDER: Status[] = ['focused', 'on_break', 'absent'];

export function StatusBoard({ friends, now }: { friends: Friend[]; now: number }) {
  return (
    <View style={styles.board}>
      {ORDER.map((status) => {
        const meta = statusMeta[status];
        const list = friends.filter((f) => f.status === status);
        return (
          <View key={status} style={styles.column}>
            <View style={styles.header}>
              <View style={[styles.dot, { backgroundColor: meta.color }]} />
              <Text style={styles.title}>{meta.label}</Text>
              <Text style={styles.count}>{list.length}</Text>
            </View>
            {list.length === 0 ? (
              <Text style={styles.empty}>Nobody</Text>
            ) : (
              list.map((f) => (
                <View key={f.username} style={[styles.friend, { backgroundColor: meta.bg }]}>
                  <Text style={styles.name}>{f.display_name}</Text>
                  <Text style={styles.detail}>
                    {status === 'focused' && f.ends_at
                      ? `${formatMinutes(Date.parse(f.ends_at) - now)} left`
                      : `@${f.username}`}
                  </Text>
                </View>
              ))
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Three columns side by side when there's room, stacked on phones.
  board: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  column: {
    flexGrow: 1,
    flexBasis: 180,
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  title: { fontWeight: '700', fontSize: 16, color: colors.text, flex: 1 },
  count: { color: colors.muted, fontWeight: '600' },
  empty: { color: colors.muted, fontStyle: 'italic' },
  friend: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: { fontWeight: '600', color: colors.text },
  detail: { color: colors.muted, fontSize: 13 },
});
