import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Panel } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { api, breakMinutes, MAX_SESSION_MIN, type Me } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { cancelSessionEnd, scheduleSessionEnd } from '@/lib/notifications';

const PRESETS = [25, 50, 90, 120];
const clamp = (m: number) => Math.min(MAX_SESSION_MIN, Math.max(1, m));

type Props = {
  me: Me;
  setMe: (me: Me) => void;
  refresh: () => void;
  onWalkOut: () => void;
};

/** The office's bottom panel: pick a length and start, or the running countdown. */
export function StudyPanel({ me, setMe, refresh, onWalkOut }: Props) {
  const tone = useTone();
  const [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<Me>) => {
    setBusy(true);
    setError(null);
    try {
      setMe(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const next = await api.startSession(minutes);
      playSound('pop');
      scheduleSessionEnd(new Date(Date.now() + minutes * 60_000), minutes);
      return next;
    });

  const giveUp = async () => {
    const ok = await confirm(
      'Give up?',
      "You won't get any chips or a break for this session.",
      'Give up'
    );
    if (!ok) return;
    run(async () => {
      const next = await api.cancelSession();
      cancelSessionEnd();
      return next;
    });
  };

  const session = me.active_session;
  if (session) {
    return (
      <Panel style={styles.center}>
        <Countdown
          until={session.ends_at}
          onDone={refresh}
          style={[styles.countdown, { color: tone.text }]}
        />
        <Muted>{`Studying · ${session.duration_min} min`}</Muted>
        <Button title="Give up" variant="ghost" small onPress={giveUp} disabled={busy} />
        {error && <Text style={{ color: tone.danger }}>{error}</Text>}
      </Panel>
    );
  }

  return (
    <Panel>
      <View style={styles.stepper}>
        <Button
          title="−5"
          variant="quiet"
          small
          onPress={() => setMinutes((m) => clamp(m - 5))}
          style={styles.step}
        />
        <View style={styles.minutes}>
          <TextInput
            value={String(minutes)}
            onChangeText={(t) => setMinutes(clamp(parseInt(t.replace(/\D/g, ''), 10) || 1))}
            keyboardType="number-pad"
            maxLength={3}
            accessibilityLabel="Session length in minutes"
            style={[styles.minutesInput, { color: tone.text }]}
          />
          <Text style={{ color: tone.muted, fontSize: 15 }}>min</Text>
        </View>
        <Button
          title="+5"
          variant="quiet"
          small
          onPress={() => setMinutes((m) => clamp(m + 5))}
          style={styles.step}
        />
      </View>
      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Button
            key={p}
            title={p === 120 ? '2h' : `${p}m`}
            variant={p === minutes ? 'primary' : 'quiet'}
            small
            onPress={() => setMinutes(p)}
            style={styles.preset}
          />
        ))}
      </View>
      <Muted style={styles.centerText}>
        {`Earns about ${minutes} chip${minutes === 1 ? '' : 's'} and a ${breakMinutes(minutes)} min break.`}
      </Muted>
      <Button title={`Start ${minutes} min`} onPress={start} disabled={busy} />
      <Button title="Walk out" variant="ghost" small onPress={onWalkOut} />
      {error && <Text style={{ color: tone.danger, textAlign: 'center' }}>{error}</Text>}
    </Panel>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  countdown: { fontSize: 52, fontWeight: '300', fontVariant: ['tabular-nums'], letterSpacing: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  step: { width: 56 },
  minutes: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  minutesInput: {
    fontSize: 38,
    fontWeight: '300',
    width: 84,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  presets: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1 },
});
