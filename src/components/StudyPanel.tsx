import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Panel } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { Tip } from '@/components/Tip';
import { api, AWAY_GRACE_S, breakMinutes, MAX_SESSION_MIN, type Me } from '@/lib/api';
import { otherTabsAllowed, pageId } from '@/lib/away';
import { confirm } from '@/lib/confirm';
import { sendInvite } from '@/lib/invites';
import { cancelSessionEnd, scheduleSessionEnd } from '@/lib/notifications';

const PRESETS = [25, 50, 90, 120];
const clamp = (m: number) => Math.min(MAX_SESSION_MIN, Math.max(1, m));

type Props = {
  me: Me;
  setMe: (me: Me) => void;
  refresh: () => void;
  onWalkOut: () => void;
  /** On a break: back out to the garden, until the next session starts. */
  onGarden: () => void;
  /** Opens your desk, to arrange it (between sessions). */
  onArrange: () => void;
};

/** The office's bottom panel: pick a length and start, or the running countdown. */
export function StudyPanel({ me, setMe, refresh, onWalkOut, onGarden, onArrange }: Props) {
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
      const next = await api.startSession(minutes, pageId);
      playSound('pop');
      scheduleSessionEnd(new Date(Date.now() + minutes * 60_000), minutes);
      return next;
    });

  // New players can skip their first session, to see the payout and the garden.
  const firstTime = me.sessions_done === 0;
  const skip = () =>
    run(async () => {
      const next = await api.skipFirstSession();
      cancelSessionEnd();
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
    const here = session.device === pageId;
    // On a computer, other tabs are fine; on a phone, Focus has to stay in front.
    const tabsOk = otherTabsAllowed();
    const strict = session.hard && here;
    return (
      <Panel style={styles.center}>
        {session.hard ? (
          <Tip id="stay">
            {tabsOk
              ? 'Hard mode: keep this tab open while you study. Other tabs and windows are fine, for notes or reading. Close this one and the session stops, with no chips.'
              : `Hard mode: keep Focus Together open while you study. Switch apps or tabs, or lock your phone, for more than ${AWAY_GRACE_S} seconds and the session stops, with no chips.`}
          </Tip>
        ) : (
          <Tip id="away">
            You can leave the page while you study: the session carries on, and pays when it ends.
            For the strict rules, turn on hard mode in settings before you start.
          </Tip>
        )}
        <Countdown
          until={session.ends_at}
          onDone={refresh}
          style={[styles.countdown, { color: tone.text }]}
        />
        <Muted style={styles.centerText}>
          {!here
            ? `Studying · ${session.duration_min} min · started on another page`
            : strict
              ? `Studying · ${session.duration_min} min · hard mode · ${tabsOk ? 'keep this tab open' : 'stay on this page'}`
              : `Studying · ${session.duration_min} min`}
        </Muted>
        <StudyInvite />
        {firstTime && <Button title="Skip my first session" small onPress={skip} disabled={busy} />}
        <Button title="Give up" variant="ghost" small onPress={giveUp} disabled={busy} />
        {error && <Text style={{ color: tone.danger }}>{error}</Text>}
      </Panel>
    );
  }

  const left = me.left_session;
  return (
    <Panel>
      {left ? (
        <Text style={[styles.left, { color: tone.text, borderColor: tone.line }]}>
          {`You left the page ${minutesIn(left.started_at, left.left_at)} into your session, so it stopped: no chips or break this time.`}
        </Text>
      ) : (
        firstTime && (
          <Tip id="study">
            Pick how long to study and press Start. New here? Once it has started you can skip your
            first session, to look round first.
          </Tip>
        )
      )}
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
      {me.hard_mode && (
        <Muted style={styles.centerText}>Hard mode is on. You can turn it off in settings.</Muted>
      )}
      <Button title={`Start ${minutes} min`} onPress={start} disabled={busy} />
      {me.status === 'on_break' && me.break_ends_at && (
        <Button title="Back to the garden" variant="quiet" onPress={onGarden} />
      )}
      <View style={styles.presets}>
        <Button
          title="Arrange your desk"
          variant="ghost"
          small
          onPress={onArrange}
          style={styles.preset}
        />
        <Button title="Walk out" variant="ghost" small onPress={onWalkOut} style={styles.preset} />
      </View>
      {error && <Text style={{ color: tone.danger, textAlign: 'center' }}>{error}</Text>}
    </Panel>
  );
}

/** While you study: a link that has someone study with you, signing up first if they need to. */
function StudyInvite() {
  const tone = useTone();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; ok: boolean } | null>(null);
  const invite = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const { code, ends_at } = await api.inviteToSession();
      const until = new Date(ends_at).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
      const text = await sendInvite(
        code,
        `Come and study with me on Focus Together, until ${until}.`,
        `Link copied. Whoever opens it studies with you until ${until}, and joins as your friend.`
      );
      if (text) setSaid({ text, ok: true });
    } catch (e) {
      setSaid({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        title="Invite someone to study with you"
        variant="quiet"
        small
        onPress={invite}
        disabled={busy}
      />
      {said && (
        <Text
          style={[styles.centerText, { color: said.ok ? tone.accent : tone.danger, fontSize: 13 }]}
        >
          {said.text}
        </Text>
      )}
    </>
  );
}

/** "5 minutes", "a minute", "a few seconds". */
function minutesIn(from: string, to: string) {
  const m = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
  return m < 1 ? 'a few seconds' : m === 1 ? 'a minute' : `${m} minutes`;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  left: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
