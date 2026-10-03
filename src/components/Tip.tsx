import { useCallback, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { api } from '@/lib/api';
import { useWorld } from '@/world/World';

/**
 * Tips for new players: one at a time, at the top of a place's panel, until
 * it's done or put away. Which tips are done is kept on the server (per
 * account), so they don't come back on another device.
 */
export function useTips() {
  const { me, setMe } = useWorld();
  const tips = me.tips;
  const has = useCallback((id: string) => tips.includes(id) || doneHere.has(id), [tips]);
  const done = useCallback(
    (id: string) => {
      if (tips.includes(id) || doneHere.has(id)) return;
      doneHere.add(id);
      setMe({ ...me, tips: [...tips, id] });
      api.doneTip(id).then(setMe, () => {});
    },
    [me, tips, setMe]
  );
  return { has, done };
}

/** Tips put away on this page, so a reply that was already on its way can't bring one back. */
const doneHere = new Set<string>();

/** Brings every tip back (after "show the tips again"). */
export function forgetTips() {
  doneHere.clear();
}

/** A tip, unless it's been seen to. `children` is what it says. */
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const tone = useTone();
  const tips = useTips();
  if (tips.has(id)) return null;
  return (
    <View
      style={[styles.tip, { backgroundColor: tone.raised, borderColor: tone.line }]}
      accessibilityRole="summary"
    >
      <Text style={[styles.text, { color: tone.text }]}>{children}</Text>
      <Pressable
        onPress={() => tips.done(id)}
        accessibilityRole="button"
        accessibilityLabel="Got it: hide this tip"
        hitSlop={10}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Text style={[styles.ok, { color: tone.accent }]}>Got it</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 18 },
  ok: { fontSize: 13, fontWeight: '600' },
});
