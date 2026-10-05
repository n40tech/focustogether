import { useEffect, useState, type ReactNode } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nativeDriver } from '@/art/motion';
import { useReportPanelHeight, useTone } from '@/art/Scene';
import { setSoundSettings, useSound, wasOnBeforeTap } from '@/audio/sound';
import { font, palette } from '@/lib/theme';

/** A poker chip, drawn small. */
export function ChipIcon({ size = 14 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.chips.red,
        borderWidth: size / 6,
        borderColor: palette.chips.edge,
        borderStyle: 'dashed',
      }}
    />
  );
}

export function ChipCount({ chips }: { chips: number }) {
  const tone = useTone();
  return (
    <View
      style={[styles.pill, { backgroundColor: tone.panel }]}
      accessibilityLabel={`${chips} chips`}
    >
      <ChipIcon />
      <Text style={[styles.pillText, { color: tone.chip }]}>{chips.toLocaleString()}</Text>
    </View>
  );
}

export function SoundButton() {
  const tone = useTone();
  const { muted, unlocked } = useSound();
  const label = !unlocked ? 'Sound' : muted ? 'Muted' : 'Sound on';
  return (
    <Pressable
      // The tap that turns sound on mustn't turn it straight off again.
      onPress={() => wasOnBeforeTap() && setSoundSettings({ muted: !muted })}
      accessibilityRole="button"
      accessibilityLabel={muted ? 'Unmute' : 'Mute'}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: tone.panel, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.pillText, { color: unlocked && !muted ? tone.text : tone.muted }]}>
        {unlocked && !muted ? '♪' : '–'} {label}
      </Text>
    </Pressable>
  );
}

/** Place name (and an optional detail) on the left; chips and sound on the right. */
export function SceneHeader({
  place,
  chips,
  detail,
}: {
  place: string;
  chips?: number;
  detail?: ReactNode;
}) {
  const tone = useTone();
  return (
    <View style={styles.header} pointerEvents="box-none">
      <View style={styles.row} pointerEvents="box-none">
        <View style={[styles.pill, { backgroundColor: tone.panel }]}>
          <Text style={[font.label, { color: tone.muted }]}>{place}</Text>
          {detail}
        </View>
      </View>
      <View style={styles.row} pointerEvents="box-none">
        {chips !== undefined && <ChipCount chips={chips} />}
        <SoundButton />
      </View>
    </View>
  );
}

/** The bottom action panel. */
export function Panel({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const tone = useTone();
  const insets = useSafeAreaInsets();
  const report = useReportPanelHeight();
  useEffect(() => () => report(0), [report]);
  return (
    <View
      style={[styles.panelWrap, { paddingBottom: 12 + insets.bottom }]}
      pointerEvents="box-none"
      onLayout={(e) => report(Math.ceil(e.nativeEvent.layout.height))}
    >
      <View style={[styles.panel, { backgroundColor: tone.panel, borderColor: tone.line }, style]}>
        {children}
      </View>
    </View>
  );
}

/** A modal card over the scene, for choices (seeds, basket, trades). */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const tone = useTone();
  const insets = useSafeAreaInsets();
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[styles.sheetWrap, { paddingBottom: 12 + insets.bottom }]}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, { backgroundColor: tone.panel, borderColor: tone.line }]}>
          <View style={styles.sheetHead}>
            <Text style={[font.label, { color: tone.muted }]}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={12}
            >
              <Text style={{ color: tone.muted, fontSize: 18 }}>×</Text>
            </Pressable>
          </View>
          {children}
        </View>
      </View>
    </View>
  );
}

/**
 * A short message under the header that fades away by itself: what went wrong,
 * or something like the rain watering your beds. Shows over sheets too. Give
 * each message its own `key` so a repeat shows again.
 */
export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const tone = useTone();
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const show = Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: nativeDriver }),
      Animated.delay(Math.min(6000, 2600 + text.length * 40)),
      Animated.timing(fade, { toValue: 0, duration: 500, useNativeDriver: nativeDriver }),
    ]);
    show.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => show.stop();
  }, [fade, text, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toastWrap, { top: insets.top + 60, opacity: fade }]}
    >
      <Text style={[styles.toast, { backgroundColor: tone.panel, color: tone.text }]}>{text}</Text>
    </Animated.View>
  );
}

/** A quiet note beside the place name in the header, like the weather. */
export function HeaderDetail({ children }: { children: ReactNode }) {
  const tone = useTone();
  return <Text style={{ color: tone.muted, fontSize: 12 }}>· {children}</Text>;
}

export function Muted({
  children,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  style?: object;
  numberOfLines?: number;
}) {
  const tone = useTone();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ color: tone.muted, fontSize: 13, lineHeight: 18 }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: object }) {
  const tone = useTone();
  return (
    <Text style={[{ color: tone.text, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>
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
  pillText: { fontSize: 13, fontWeight: '600' },
  panelWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    padding: 12,
  },
  panel: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  backdrop: { backgroundColor: 'rgba(20, 22, 26, 0.35)' },
  toastWrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  toast: {
    maxWidth: 420,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    overflow: 'hidden',
    fontSize: 14,
    lineHeight: 19,
    textAlign: 'center',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 12 },
  sheet: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '80%',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
