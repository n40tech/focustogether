import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Person } from '@/art/People';
import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Sheet } from '@/components/Chrome';
import { api } from '@/lib/api';
import { COLOURS, HAIR_COLOURS, HAIRSTYLES, SKINS, type Looks } from '@/lib/looks';
import { font } from '@/lib/theme';
import { useLooksOf, useWorld } from '@/world/World';

const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Choosing how you look: skin, favourite colour, hairstyle and hair colour. Friends see it. */
export function LooksSheet({ onClose }: { onClose: () => void }) {
  const tone = useTone();
  const { me, setLooks } = useWorld();
  const [draft, setDraft] = useState<Looks>(useLooksOf(me.username));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (change: Partial<Looks>) => setDraft((d) => ({ ...d, ...change }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setLooks(await api.setLooks(draft));
      playSound('paper');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="Your look" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        <View style={styles.preview}>
          <View style={styles.figure}>
            <Person username={me.username} x={24} y={46} looks={draft} />
          </View>
        </View>
        <Swatches
          label="Skin"
          options={SKINS}
          value={draft.skin}
          onChange={(skin) => set({ skin })}
        />
        <Swatches
          label="Favourite colour"
          options={COLOURS}
          value={draft.colour}
          onChange={(colour) => set({ colour })}
        />
        <Text style={[font.label, { color: tone.muted }]}>Hairstyle</Text>
        <View style={styles.row}>
          {HAIRSTYLES.map((hair) => (
            <Button
              key={hair}
              title={capital(hair)}
              accessibilityLabel={`Hairstyle: ${capital(hair)}`}
              variant={draft.hair === hair ? 'primary' : 'quiet'}
              small
              onPress={() => set({ hair })}
            />
          ))}
        </View>
        <Swatches
          label="Hair colour"
          options={HAIR_COLOURS}
          value={draft.hair_colour}
          onChange={(hair_colour) => set({ hair_colour })}
        />
        <Button title="Save my look" onPress={save} disabled={busy} />
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
      </ScrollView>
    </Sheet>
  );
}

function Swatches({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { name: string; hex: string }[];
  value: number;
  onChange: (i: number) => void;
}) {
  const tone = useTone();
  return (
    <>
      <Text style={[font.label, { color: tone.muted }]}>{label}</Text>
      <View style={styles.row}>
        {options.map((o, i) => (
          <Pressable
            key={o.name}
            onPress={() => onChange(i)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${o.name}`}
            accessibilityState={{ selected: value === i }}
            hitSlop={4}
            style={[
              styles.swatch,
              { backgroundColor: o.hex, borderColor: value === i ? tone.text : 'transparent' },
            ]}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, paddingBottom: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // The person is drawn in stage units at twice the size, centred.
  preview: { height: 96, alignItems: 'center', justifyContent: 'center' },
  figure: { width: 48, height: 48, transform: [{ scale: 2 }] },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 3 },
});
