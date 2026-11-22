import { usePathname } from 'expo-router';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { setSoundSettings, useSound, wasOnBeforeTap } from '@/audio/sound';
import { ChipCount } from '@/components/Chrome';
import { FriendsIcon, GearIcon, SoundIcon, WeatherIcon } from '@/components/Icons';
import { SettingsSheet } from '@/components/Settings';
import type { Conditions } from '@/weather/conditions';
import { useGo, useWorld } from '@/world/World';

// Whether settings are open: the cog opens them, and so can a tip (see openSettings).
let settingsOpen = false;
const settingsListeners = new Set<() => void>();
const subscribeSettings = (listener: () => void) => {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
};

/** Opens (or closes) the settings sheet, from anywhere with a header. */
export function openSettings(open = true) {
  settingsOpen = open;
  settingsListeners.forEach((l) => l());
}

/**
 * Across the top of every place: the Friends board, sound and the weather on
 * the left; a detail (like your break), your chips and settings on the right.
 */
export function SceneHeader({
  chips,
  detail,
  weather,
}: {
  chips?: number;
  detail?: ReactNode;
  /** Outdoors, the weather. */
  weather?: Conditions;
}) {
  const tone = useTone();
  const { me } = useWorld();
  const pathname = usePathname();
  const go = useGo();
  const settings = useSyncExternalStore(
    subscribeSettings,
    () => settingsOpen,
    () => settingsOpen
  );
  // Leaving a place (or logging out) closes them.
  useEffect(() => () => openSettings(false), []);
  // While you study, the office is the only place there is.
  const friends = me.status !== 'focused' && pathname !== '/friends';
  return (
    <>
      <View style={styles.header} pointerEvents="box-none">
        <View style={styles.row} pointerEvents="box-none">
          {friends && (
            <Round
              label="Friends"
              onPress={() => go({ pathname: '/friends', params: { from: pathname } }, null)}
            >
              <FriendsIcon color={tone.text} />
            </Round>
          )}
          <SoundButton />
          {weather && <Weather conditions={weather} />}
        </View>
        <View style={styles.row} pointerEvents="box-none">
          {detail && <View style={[styles.pill, { backgroundColor: tone.panel }]}>{detail}</View>}
          {chips !== undefined && <ChipCount chips={chips} />}
          <Round label="Settings" onPress={() => openSettings()}>
            <GearIcon color={tone.text} bg={tone.panel} />
          </Round>
        </View>
      </View>
      {settings && (
        // Over the bottom panel, which comes after the header.
        <View style={styles.over} pointerEvents="box-none">
          <SettingsSheet onClose={() => openSettings(false)} />
        </View>
      )}
    </>
  );
}

function Round({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress?: () => void;
  children: ReactNode;
}) {
  const tone = useTone();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.round,
        { backgroundColor: tone.panel, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      {children}
    </Pressable>
  );
}

export function SoundButton() {
  const tone = useTone();
  const { muted, unlocked } = useSound();
  const on = unlocked && !muted;
  return (
    <Round
      label={muted ? 'Unmute' : unlocked ? 'Mute' : 'Start the sound'}
      // The tap that starts the sound mustn't mute it straight away.
      onPress={() => {
        if (muted) setSoundSettings({ muted: false });
        else if (wasOnBeforeTap()) setSoundSettings({ muted: true });
      }}
    >
      <SoundIcon color={on ? tone.text : tone.muted} on={on} />
    </Round>
  );
}

/** The weather as an icon; tap it for a word or two. */
function Weather({ conditions }: { conditions: Conditions }) {
  const tone = useTone();
  const [saying, setSaying] = useState(false);
  useEffect(() => {
    if (!saying) return;
    const id = setTimeout(() => setSaying(false), 3000);
    return () => clearTimeout(id);
  }, [saying]);
  return (
    <Pressable
      onPress={() => setSaying((s) => !s)}
      accessibilityRole="button"
      accessibilityLabel={`Weather: ${conditions.label}`}
      hitSlop={6}
      style={[styles.round, saying && styles.saying, { backgroundColor: tone.panel }]}
    >
      <WeatherIcon color={tone.text} bg={tone.panel} conditions={conditions} />
      {saying && (
        <Text style={{ color: tone.muted, fontSize: 12 }} numberOfLines={1}>
          {conditions.label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  round: {
    height: 34,
    minWidth: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  saying: { gap: 6, paddingLeft: 7, paddingRight: 12 },
  over: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 },
});
