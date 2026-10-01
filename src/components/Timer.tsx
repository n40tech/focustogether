import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from './Button';
import { api, BREAK_WINDOW_MS, MAX_SESSION_MIN, type Me } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { cancelSessionEnd, scheduleSessionEnd } from '@/lib/notifications';
import { colors, statusMeta } from '@/lib/theme';
import { formatCountdown, formatMinutes } from '@/lib/time';

const PRESETS = [25, 50, 90, 120];

type Props = {
  me: Me;
  /** Current time, corrected to the server's clock. */
  now: number;
  onMeChange: (me: Me) => void;
  refresh: () => void;
};

export function Timer({ me, now, onMeChange, refresh }: Props) {
  const [minutes, setMinutes] = useState(25);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = me.active_session;
  const remaining = session ? Date.parse(session.ends_at) - now : 0;
  const expired = !!session && remaining <= 0;

  // When the countdown hits zero, ask the server to complete it and award points.
  useEffect(() => {
    if (expired) refresh();
  }, [expired, refresh]);

  const run = async (action: () => Promise<Me>) => {
    setBusy(true);
    setError(null);
    try {
      onMeChange(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const next = await api.startSession(minutes);
      scheduleSessionEnd(new Date(Date.now() + minutes * 60_000), minutes);
      return next;
    });

  const cancel = async () => {
    const ok = await confirm(
      'Cancel session?',
      "You won't get any points for this session.",
      'Cancel session'
    );
    if (!ok) return;
    run(async () => {
      const next = await api.cancelSession();
      cancelSessionEnd();
      return next;
    });
  };

  const leave = () => run(api.leave);

  if (session) {
    const total = session.duration_min * 60_000;
    const progress = Math.min(1, Math.max(0, 1 - remaining / total));
    return (
      <View style={styles.card}>
        <Text style={[styles.label, { color: statusMeta.focused.color }]}>FOCUSING</Text>
        <Text style={styles.countdown} accessibilityRole="timer">
          {formatCountdown(remaining)}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.sub}>
          {expired
            ? 'Finishing up…'
            : `${session.duration_min} min session · +${session.duration_min} pts when done`}
        </Text>
        {!expired && (
          <Button title="Cancel session" variant="danger" onPress={cancel} disabled={busy} />
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  const last = me.last_completed;
  const breakEndsIn = last ? Date.parse(last.ended_at) + BREAK_WINDOW_MS - now : 0;
  const justFinished = last && now - Date.parse(last.ended_at) < 2 * 60_000;

  return (
    <View style={styles.card}>
      {me.status === 'on_break' && last && (
        <View style={styles.breakBanner}>
          <View style={{ flex: 1 }}>
            <Text style={styles.breakTitle}>
              {justFinished ? `Session complete! +${last.duration_min} pts 🎉` : 'On break'}
            </Text>
            <Text style={styles.breakSub}>
              {`Break ends in ${formatMinutes(breakEndsIn)}. Tap Leave when you're done for now.`}
            </Text>
          </View>
          <Button title="Leave" variant="outline" onPress={leave} disabled={busy} />
        </View>
      )}

      <Text style={styles.label}>NEW FOCUS SESSION</Text>

      <View style={styles.stepper}>
        <Button
          title="−5"
          variant="outline"
          onPress={() => setMinutes((m) => clamp(m - 5))}
          style={styles.stepBtn}
        />
        <View style={styles.minutesBox}>
          <TextInput
            value={String(minutes)}
            onChangeText={(t) => setMinutes(clamp(parseInt(t.replace(/\D/g, ''), 10) || 1))}
            keyboardType="number-pad"
            style={styles.minutesInput}
            maxLength={3}
            accessibilityLabel="Session length in minutes"
          />
          <Text style={styles.minutesUnit}>min</Text>
        </View>
        <Button
          title="+5"
          variant="outline"
          onPress={() => setMinutes((m) => clamp(m + 5))}
          style={styles.stepBtn}
        />
      </View>

      <View style={styles.presets}>
        {PRESETS.map((p) => (
          <Button
            key={p}
            title={p === 120 ? '2h' : `${p}m`}
            variant={p === minutes ? 'primary' : 'outline'}
            onPress={() => setMinutes(p)}
            style={styles.preset}
          />
        ))}
      </View>

      <Button title={`Start ${minutes} min focus`} onPress={start} disabled={busy} />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const clamp = (m: number) => Math.min(MAX_SESSION_MIN, Math.max(1, m));

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: colors.muted },
  countdown: {
    fontSize: 64,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: statusMeta.focused.color },
  sub: { color: colors.muted, textAlign: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  stepBtn: { width: 64 },
  minutesBox: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  minutesInput: {
    fontSize: 48,
    fontWeight: '700',
    color: colors.text,
    minWidth: 90,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    padding: 0,
  },
  minutesUnit: { fontSize: 18, color: colors.muted },
  presets: { flexDirection: 'row', gap: 8 },
  preset: { flex: 1, paddingHorizontal: 0, paddingVertical: 8 },
  breakBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: statusMeta.on_break.bg,
    borderRadius: 14,
    padding: 14,
  },
  breakTitle: { fontWeight: '700', color: statusMeta.on_break.color, fontSize: 16 },
  breakSub: { color: colors.muted, marginTop: 2, fontSize: 13 },
  error: { color: colors.danger, textAlign: 'center' },
});
