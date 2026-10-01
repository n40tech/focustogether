import type { ReactNode } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';

/** An absolutely positioned rectangle in stage units (x, y = top-left). */
export function Box({
  x,
  y,
  w,
  h,
  c,
  r = 0,
  o,
  style,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  c?: string;
  r?: number;
  o?: number;
  style?: ViewStyle;
  children?: ReactNode;
}) {
  return (
    <View
      pointerEvents={children ? 'box-none' : 'none'}
      style={[
        {
          position: 'absolute',
          left: x,
          top: y,
          width: w,
          height: h,
          backgroundColor: c,
          borderRadius: r,
          opacity: o,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A circle or ellipse centred on (x, y). */
export function Dot({
  x,
  y,
  d,
  h,
  c,
  o,
  style,
}: {
  x: number;
  y: number;
  d: number;
  h?: number;
  c: string;
  o?: number;
  style?: ViewStyle;
}) {
  const height = h ?? d;
  return (
    <View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: x - d / 2,
          top: y - height / 2,
          width: d,
          height,
          borderRadius: Math.max(d, height) / 2,
          backgroundColor: c,
          opacity: o,
        },
        style,
      ]}
    />
  );
}

const rgba = (hex: string, alpha: number) =>
  `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')}, ${alpha})`;

/**
 * A soft pool of light (or shade) w × h, centred on (x, y), reaching opacity
 * `o` in the middle: a small core with a wide blurred shadow, so it fades
 * smoothly to nothing.
 */
export function Glow({
  x,
  y,
  w,
  h,
  c,
  o = 0.5,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  c: string;
  o?: number;
}) {
  const r = h / 2;
  const core = r * 0.6;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - core / 2,
        top: y - core / 2,
        width: core,
        height: core,
        borderRadius: core / 2,
        backgroundColor: rgba(c, o),
        boxShadow: `0 0 ${r}px ${r * 0.15}px ${rgba(c, o)}`,
        transform: [{ scaleX: w / h }],
      }}
    />
  );
}

/** A soft shadow under something standing on the ground. */
export function Shadow({ x, y, w, o = 0.18 }: { x: number; y: number; w: number; o?: number }) {
  return <Dot x={x} y={y} d={w} h={w * 0.3} c="#1d1f22" o={o} />;
}

/** A small name tag centred under (x, y). Lives in the untinted overlay layer. */
export function Tag({ x, y, text, dim }: { x: number; y: number; text: string; dim?: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: x - 60, top: y, width: 120, alignItems: 'center' }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontSize: 10,
          fontWeight: '600',
          color: '#f4f0e8',
          backgroundColor: dim ? 'rgba(30, 32, 36, 0.32)' : 'rgba(30, 32, 36, 0.55)',
          paddingHorizontal: 6,
          paddingVertical: 1,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** A tappable region of the scene (a door, the kiosk, a bed). */
export function Hotspot({
  x,
  y,
  w,
  h,
  label,
  onPress,
  disabled,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        borderRadius: 8,
        backgroundColor: pressed ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
      })}
    />
  );
}
