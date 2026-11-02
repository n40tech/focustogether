import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { Joystick } from '@/components/Joystick';
import { otherTabsAllowed } from '@/lib/away';
import type { Direction } from '@/world/useWalker';

/**
 * How you steer, under your thumb: a thumbstick on a touchscreen; on a
 * computer, which keys to press (W A S D, or the arrows), where the stick
 * would be.
 */
export function Steering({
  size,
  onChange,
  driving = false,
}: {
  size: number;
  onChange: (direction: Direction) => void;
  /** In a vehicle, the keys go and steer rather than walk. */
  driving?: boolean;
}) {
  const [keyboard] = useState(otherTabsAllowed);
  if (!keyboard) return <Joystick size={size} onChange={onChange} />;
  return <Keys size={size} driving={driving} />;
}

function Keys({ size, driving }: { size: number; driving: boolean }) {
  const tone = useTone();
  const cap = Math.floor((size - 6) / 3);
  const key = (letter: string) => (
    <View
      style={[
        styles.key,
        { width: cap, height: cap, borderColor: tone.line, backgroundColor: tone.raised },
      ]}
    >
      <Text style={[styles.letter, { color: tone.text }]}>{letter}</Text>
    </View>
  );
  return (
    <View
      style={[styles.keys, { width: size }]}
      accessibilityLabel={
        driving
          ? 'Drive with W and S, and steer with A and D (or the arrow keys)'
          : 'Walk with W, A, S and D (or the arrow keys)'
      }
    >
      {key('W')}
      <View style={styles.row}>
        {key('A')}
        {key('S')}
        {key('D')}
      </View>
      <Text style={[styles.caption, { color: tone.muted }]}>
        {driving ? 'W go · S back\nA D steer' : 'or the arrows'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  keys: { alignItems: 'center', gap: 3 },
  row: { flexDirection: 'row', gap: 3 },
  key: {
    borderWidth: 1,
    borderBottomWidth: 3,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { fontSize: 13, fontWeight: '600' },
  caption: { fontSize: 10, lineHeight: 13, textAlign: 'center', marginTop: 2 },
});
