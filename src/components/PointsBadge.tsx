import { StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

export function PointsBadge({ points }: { points: number }) {
  return (
    <View style={styles.badge} accessibilityLabel={`${points} points`}>
      <Text style={styles.text}>⭐ {points.toLocaleString()} pts</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: colors.goldBg,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: { color: colors.gold, fontWeight: '700', fontSize: 15 },
});
