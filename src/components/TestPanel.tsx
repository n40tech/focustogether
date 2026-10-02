import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { api, type Me } from '@/lib/api';
import { ITEMS } from '@/lib/catalog';
import { serverNow } from '@/lib/clock';
import { font } from '@/lib/theme';
import { useWorld } from '@/world/World';
import { Button } from './Button';
import { Muted, Sheet } from './Chrome';

const SEEDS = Object.keys(ITEMS).filter((slug) => ITEMS[slug].kind === 'seed');
const PRODUCE = Object.keys(ITEMS).filter((slug) => ITEMS[slug].kind === 'produce');

/**
 * Testing tools for accounts marked as testers in the SQL editor (see
 * deployment/0002-testing-tools.md): chips, skipping ahead, items, ripe crops.
 * Everyone else never sees it, and the server refuses them anyway.
 */
export function TestPanel() {
  const { me, setMe } = useWorld();
  const tone = useTone();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  if (!me.tester) return null;

  const run = async (label: string, action: () => Promise<Me>) => {
    setBusy(true);
    try {
      setMe(await action());
      setNote({ text: label, ok: true });
      playSound('coin');
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };
  const each = (items: string[], qty: number) => async () => {
    let last: Me = me;
    for (const item of items) last = await api.dev.item(item, qty);
    return last;
  };
  const sessionLeft = me.active_session
    ? Math.max(1, Math.ceil((Date.parse(me.active_session.ends_at) - serverNow()) / 60_000))
    : null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Testing tools"
        style={[styles.pill, { top: insets.top + 58, backgroundColor: tone.panel }]}
      >
        <Text style={[styles.pillText, { color: tone.muted }]}>Test</Text>
      </Pressable>
      {open && (
        <Sheet title="Testing tools" onClose={() => setOpen(false)}>
          <ScrollView contentContainerStyle={styles.list}>
            <Section title={`Chips (you have ${me.chips})`}>
              <Act
                title="+100"
                busy={busy}
                onPress={() => run('Added 100 chips.', () => api.dev.chips(100))}
              />
              <Act
                title="+1000"
                busy={busy}
                onPress={() => run('Added 1000 chips.', () => api.dev.chips(1000))}
              />
              <Act
                title="−100"
                busy={busy}
                onPress={() => run('Took 100 chips.', () => api.dev.chips(-100))}
              />
            </Section>
            <Section title="Skip ahead (your clock only)">
              {sessionLeft !== null && (
                <Act
                  title={`Finish my session (${sessionLeft} min)`}
                  busy={busy}
                  onPress={() => run('Session finished.', () => api.dev.skip(sessionLeft))}
                />
              )}
              <Act
                title="5 min"
                busy={busy}
                onPress={() => run('Skipped 5 minutes.', () => api.dev.skip(5))}
              />
              <Act
                title="30 min"
                busy={busy}
                onPress={() => run('Skipped 30 minutes.', () => api.dev.skip(30))}
              />
              <Act
                title="2 hours"
                busy={busy}
                onPress={() => run('Skipped 2 hours.', () => api.dev.skip(120))}
              />
              <Act
                title="1 day"
                busy={busy}
                onPress={() => run('Skipped a day.', () => api.dev.skip(1440))}
              />
            </Section>
            <Section title="Garden">
              <Act
                title="Ripen my crops"
                busy={busy}
                onPress={() => run('Everything planted is ripe.', api.dev.ripen)}
              />
              <Act
                title="3 of each seed"
                busy={busy}
                onPress={() => run('Added 3 of each seed.', each(SEEDS, 3))}
              />
              <Act
                title="3 of each crop"
                busy={busy}
                onPress={() => run('Added 3 of each crop.', each(PRODUCE, 3))}
              />
              <Act
                title="5 cigarettes"
                busy={busy}
                onPress={() => run('Added 5 cigarettes.', () => api.dev.item('cigarette', 5))}
              />
            </Section>
            {note && (
              <Text style={{ color: note.ok ? tone.accent : tone.danger, fontSize: 13 }}>
                {note.text}
              </Text>
            )}
            <Muted>
              {
                "Skipping moves your own timestamps back, so sessions finish, breaks run out and crops age; friends' clocks don't move. The garden catches up within a few seconds."
              }
            </Muted>
          </ScrollView>
        </Sheet>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const tone = useTone();
  return (
    <View style={styles.section}>
      <Text style={[font.label, { color: tone.muted }]}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

function Act({ title, busy, onPress }: { title: string; busy: boolean; onPress: () => void }) {
  return <Button title={title} small variant="quiet" disabled={busy} onPress={onPress} />;
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    left: 12,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  pillText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  list: { gap: 14, paddingBottom: 4 },
  section: { gap: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
});
