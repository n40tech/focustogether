import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { Button } from '@/components/Button';
import { Muted } from '@/components/Chrome';
import { pushState, turnOff, turnOn, type PushState } from '@/lib/push';
import { font } from '@/lib/theme';

const SAYS: Record<Exclude<PushState, 'unsupported'>, string> = {
  on: 'On for this device: when friends start studying, when your session or break is over, and when someone asks to be friends.',
  off: 'Hear when friends start studying, when your session or break is over, and when someone asks to be friends, even with Focus Together closed.',
  blocked:
    "Notifications are blocked for Focus Together on this device. Allow them in the browser's settings for this site, then come back.",
  'home screen':
    'On an iPhone, notifications work in the home-screen app. Add Focus Together to your home screen, open it from there, and turn them on.',
};

/** Turning notifications on or off for this device, in settings. */
export function Notifications() {
  const tone = useTone();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pushState().then(setState, () => setState('unsupported'));
  }, []);

  if (state === null || state === 'unsupported') return null;
  const flip = async (to: () => Promise<PushState>) => {
    setBusy(true);
    setError(null);
    try {
      setState(await to());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.box}>
      <Text style={[font.label, { color: tone.muted }]}>Notifications</Text>
      <View style={styles.row}>
        <Muted style={styles.flex}>{SAYS[state]}</Muted>
        {state === 'off' && (
          <Button title="Turn on" small onPress={() => flip(turnOn)} disabled={busy} />
        )}
        {state === 'on' && (
          <Button
            title="Turn off"
            small
            variant="quiet"
            onPress={() => flip(turnOff)}
            disabled={busy}
          />
        )}
      </View>
      {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
});
