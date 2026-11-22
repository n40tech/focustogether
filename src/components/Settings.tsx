import { useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

import { useTone } from '@/art/Scene';
import { setSoundSettings, useSound, type SoundLevels } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Sheet } from '@/components/Chrome';
import { api, AWAY_GRACE_S } from '@/lib/api';
import { otherTabsAllowed } from '@/lib/away';
import { cancelSessionEnd } from '@/lib/notifications';
import { setPrefs, usePrefs } from '@/lib/prefs';
import { turnOff } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { font } from '@/lib/theme';
import { useWorld } from '@/world/World';

const LEVELS: { key: keyof SoundLevels; label: string }[] = [
  { key: 'weather', label: 'Rain and wind' },
  { key: 'nature', label: 'Birds and crickets' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'room', label: 'The office' },
  { key: 'effects', label: 'Footsteps and doors' },
];

/** Sound, hard mode, who you see, and logging out. Opened from the cog in the header. */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const tone = useTone();
  const sound = useSound();
  const prefs = usePrefs();
  const { me, setMe } = useWorld();
  const studying = me.status === 'focused';

  const [hard, setHard] = useState(me.hard_mode);
  const flipHard = (value: boolean) => {
    setHard(value);
    api.setHardMode(value).then(setMe, () => setHard(!value));
  };

  // Logging out is going home: you've left, break or no break.
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logOut = async () => {
    setLeaving(true);
    setError(null);
    try {
      if (me.status !== 'absent') await api.goHome();
      await cancelSessionEnd();
      // No notifications for you on this device once you've gone.
      await turnOff().catch(() => {});
      await supabase.auth.signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLeaving(false);
    }
  };

  return (
    <Sheet title="Settings" onClose={onClose}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
        <Section title="Sound">
          <Slider
            label="Overall"
            value={sound.volume}
            onChange={(volume) => setSoundSettings({ volume })}
          />
          {LEVELS.map(({ key, label }) => (
            <Slider
              key={key}
              label={label}
              value={sound.levels[key]}
              onChange={(v) => setSoundSettings({ levels: { ...sound.levels, [key]: v } })}
            />
          ))}
          <Toggle
            label="Keep playing when you leave"
            note="The sound carries on while you're in another app or tab."
            value={sound.keepPlaying}
            onChange={(keepPlaying) => setSoundSettings({ keepPlaying })}
          />
        </Section>
        <Section title="Studying">
          <Toggle
            label="Hard mode"
            note={`${
              otherTabsAllowed()
                ? 'Close this tab mid-session and it stops, with no chips.'
                : `Leave the page for more than ${AWAY_GRACE_S} seconds mid-session and it stops, with no chips.`
            }${studying ? ' This session keeps the mode it started in.' : ''}`}
            value={hard}
            onChange={flipHard}
          />
        </Section>
        <Section title="People">
          <Toggle
            label="Show friends of friends"
            note="Your friends' friends walk about see-through and sit at the desks."
            value={prefs.friendsOfFriends}
            onChange={(friendsOfFriends) => setPrefs({ friendsOfFriends })}
          />
        </Section>
        {studying ? (
          <Muted>You can log out once this session is over.</Muted>
        ) : (
          <Button title="Log out" variant="quiet" onPress={logOut} disabled={leaving} />
        )}
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
      </ScrollView>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const tone = useTone();
  return (
    <View style={styles.section}>
      <Text style={[font.label, { color: tone.muted }]}>{title}</Text>
      {children}
    </View>
  );
}

function Toggle({
  label,
  note,
  value,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const tone = useTone();
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={[styles.label, { color: tone.text }]}>{label}</Text>
        <Muted>{note}</Muted>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: tone.line, true: tone.accent }}
      />
    </View>
  );
}

const THUMB = 20;
const TRACK_H = 32;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const STEP = 0.1;

/** A 0–1 slider: tap or drag along it. Screen readers step it up and down. */
function Slider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const tone = useTone();
  const width = useRef(1);
  // Where the track starts on the page, found as you touch it.
  const left = useRef(0);
  const to = (e: GestureResponderEvent) =>
    onChange(clamp01((e.nativeEvent.pageX - left.current - THUMB / 2) / (width.current - THUMB)));
  const pct = `${Math.round(value * 100)}%` as const;
  return (
    <View style={styles.slider}>
      <Text style={[styles.sliderLabel, { color: tone.text }]}>{label}</Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onChange(clamp01(value + (e.nativeEvent.actionName === 'increment' ? STEP : -STEP)))
        }
        onLayout={(e) => {
          width.current = Math.max(THUMB + 1, e.nativeEvent.layout.width);
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          left.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
          to(e);
        }}
        onResponderMove={to}
        style={styles.track}
      >
        <View pointerEvents="none" style={[styles.rail, { backgroundColor: tone.line }]}>
          <View style={[styles.fill, { width: pct, backgroundColor: tone.accent }]} />
        </View>
        {/* As wide as the rail, less a thumb: the thumb's left edge goes along it. */}
        <View pointerEvents="none" style={styles.thumbWrap}>
          <View
            style={[
              styles.thumb,
              { left: pct, backgroundColor: tone.raised, borderColor: tone.line },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  body: { gap: 18, paddingBottom: 4 },
  section: { gap: 10 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  label: { fontSize: 14, fontWeight: '600' },
  slider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sliderLabel: { fontSize: 14, width: 132 },
  track: { flex: 1, height: TRACK_H, justifyContent: 'center' },
  rail: { height: 4, borderRadius: 2, marginHorizontal: THUMB / 2, overflow: 'hidden' },
  fill: { height: 4 },
  thumbWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: THUMB,
  },
  thumb: {
    position: 'absolute',
    top: (TRACK_H - THUMB) / 2,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 1,
  },
});
