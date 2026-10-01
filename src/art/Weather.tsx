import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { useReducedMotion } from '@/hooks/useReducedMotion';
import { serverNow } from '@/lib/clock';
import { conditionsAt, type Conditions } from '@/weather/conditions';
import { strikesBetween } from '@/weather/weather';
import { nativeDriver, rand, useLoop } from './motion';

type Size = { width: number; height: number };

/**
 * Weather as seen from above: rain falling past the camera, ripples on the
 * ground, cloud shadows drifting over it, mist, blown leaves and a soft
 * brightening when lightning strikes. There's no sky in this view.
 */
export function WeatherLayer({
  conditions,
  size,
  outdoor,
}: {
  conditions: Conditions;
  size: Size;
  /** Indoors, only the lightning reaches the scene (through the windows). */
  outdoor: boolean;
}) {
  const reduced = useReducedMotion();
  const { weather: w, light } = conditions;
  if (!size.width) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {outdoor && light.cloudShadows > 0.02 && (
        <CloudShadows size={size} strength={light.cloudShadows} paused={reduced} />
      )}
      {outdoor && w.rain > 0.04 && <Ripples size={size} rain={w.rain} paused={reduced} />}
      {outdoor && w.rain > 0.04 && (
        <Rain size={size} rain={w.rain} wind={w.wind} paused={reduced} />
      )}
      {outdoor && w.wind > 0.5 && !reduced && <Leaves size={size} wind={w.wind} />}
      {w.fog > 0.05 && <Mist size={size} fog={outdoor ? w.fog : w.fog * 0.3} paused={reduced} />}
      {!reduced && <Lightning strength={outdoor ? 0.2 : 0.07} />}
    </View>
  );
}

function Rain({
  size,
  rain,
  wind,
  paused,
}: {
  size: Size;
  rain: number;
  wind: number;
  paused: boolean;
}) {
  // A square big enough to cover the screen when tilted by the wind.
  const side = Math.hypot(size.width, size.height) + 40;
  // Tuned on a phone (a ~930 px square); bigger screens get proportionally more.
  const count = Math.min(600, Math.round((30 + 160 * rain) * (side / 930) ** 2));
  const streaks = useMemo(
    () =>
      Array.from({ length: Math.min(600, Math.round(190 * (side / 930) ** 2)) }, (_, i) => ({
        x: rand(i, 1) * side,
        y: rand(i, 2) * side,
        length: 12 + rand(i, 3) * 16,
        opacity: 0.3 + rand(i, 4) * 0.3,
      })),
    [side]
  );
  const fall = useLoop(Math.round(1300 - 500 * rain), { paused });
  const translateY = fall.interpolate({ inputRange: [0, 1], outputRange: [-side, 0] });

  return (
    <View
      style={{
        position: 'absolute',
        width: side,
        height: side,
        left: (size.width - side) / 2,
        top: (size.height - side) / 2,
        overflow: 'hidden',
        transform: [{ rotate: `${8 + 22 * wind}deg` }],
      }}
    >
      <Animated.View style={{ width: side, height: side * 2, transform: [{ translateY }] }}>
        {[0, side].map((offset) =>
          streaks.slice(0, count).map((s, i) => (
            <View
              key={`${offset}-${i}`}
              style={{
                position: 'absolute',
                left: s.x,
                top: s.y + offset,
                width: 1.6,
                height: s.length,
                borderRadius: 1,
                backgroundColor: '#eef3f7',
                opacity: s.opacity,
              }}
            />
          ))
        )}
      </Animated.View>
    </View>
  );
}

function Ripple({
  x,
  y,
  delay,
  duration,
  paused,
}: {
  x: number;
  y: number;
  delay: number;
  duration: number;
  paused: boolean;
}) {
  const t = useLoop(duration, { delay, paused });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 11,
        top: y - 4,
        width: 22,
        height: 8,
        borderRadius: 11,
        borderWidth: 1,
        borderColor: '#e6ecf0',
        opacity: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
        transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1.5] }) }],
      }}
    />
  );
}

function Ripples({ size, rain, paused }: { size: Size; rain: number; paused: boolean }) {
  const count = Math.round(4 + 14 * rain);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Ripple
          key={i}
          x={rand(i, 11) * size.width}
          y={rand(i, 12) * size.height}
          delay={Math.round(rand(i, 13) * 1600)}
          duration={1100 + Math.round(rand(i, 14) * 700)}
          paused={paused}
        />
      ))}
    </>
  );
}

/** One soft shadow crossing the screen; it wraps around while off-screen. */
function CloudShadow({
  size,
  blob,
  paused,
}: {
  size: Size;
  blob: { w: number; h: number; y: number; duration: number; delay: number };
  paused: boolean;
}) {
  const drift = useLoop(blob.duration, { delay: blob.delay, paused });
  const translateX = drift.interpolate({ inputRange: [0, 1], outputRange: [-blob.w, size.width] });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        top: blob.y * size.height - blob.h / 2,
        transform: [{ translateX }],
      }}
    >
      {[1, 0.86, 0.72, 0.58, 0.44].map((k) => (
        <View
          key={k}
          style={{
            position: 'absolute',
            left: (blob.w * (1 - k)) / 2,
            top: (blob.h * (1 - k)) / 2,
            width: blob.w * k,
            height: blob.h * k,
            borderRadius: (blob.w * k) / 2,
            backgroundColor: '#1a2320',
            opacity: 0.3,
          }}
        />
      ))}
    </Animated.View>
  );
}

function CloudShadows({
  size,
  strength,
  paused,
}: {
  size: Size;
  strength: number;
  paused: boolean;
}) {
  const blobs = [
    { w: 420, h: 260, y: 0.2, duration: 150_000, delay: 0 },
    { w: 520, h: 300, y: 0.65, duration: 180_000, delay: 40_000 },
    { w: 380, h: 240, y: 0.4, duration: 165_000, delay: 95_000 },
  ];
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: strength * 0.3 }]}>
      {blobs.map((blob, i) => (
        <CloudShadow key={i} size={size} blob={blob} paused={paused} />
      ))}
    </View>
  );
}

function Mist({ size, fog, paused }: { size: Size; fog: number; paused: boolean }) {
  const drift = useLoop(60_000, { paused });
  const translateX = drift.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-40, 40, -40] });
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#e2e5e6', opacity: fog * 0.4 }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
        {[0.25, 0.65].map((y) => (
          <View
            key={y}
            style={{
              position: 'absolute',
              left: -80,
              width: size.width + 160,
              top: y * size.height,
              height: size.height * 0.18,
              borderRadius: size.height * 0.09,
              backgroundColor: '#f0f2f2',
              opacity: fog * 0.25,
            }}
          />
        ))}
      </Animated.View>
    </View>
  );
}

function Leaf({ size, i }: { size: Size; i: number }) {
  const t = useLoop(5000 + Math.round(rand(i, 21) * 4000), {
    delay: Math.round(rand(i, 22) * 6000),
  });
  const y = rand(i, 23) * size.height;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: y,
        left: 0,
        width: 7,
        height: 4,
        borderRadius: 3,
        backgroundColor: ['#b9893f', '#9a7a3c', '#a35f3c'][i % 3],
        transform: [
          {
            translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-20, size.width + 20] }),
          },
          { translateY: t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 30, 10] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '720deg'] }) },
        ],
      }}
    />
  );
}

function Leaves({ size, wind }: { size: Size; wind: number }) {
  const count = Math.round((wind - 0.5) * 14);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Leaf key={i} size={size} i={i} />
      ))}
    </>
  );
}

/** A soft brightening when the shared lightning strikes (never a strobe). */
function Lightning({ strength }: { strength: number }) {
  const [flash] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let last = serverNow();
    const id = setInterval(() => {
      const now = serverNow();
      const stormAt = (t: number) => conditionsAt(t).weather.storm;
      if (strikesBetween(last, now, stormAt).length > 0) {
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 90, useNativeDriver: nativeDriver }),
          Animated.timing(flash, { toValue: 0, duration: 900, useNativeDriver: nativeDriver }),
        ]).start();
      }
      last = now;
    }, 400);
    return () => clearInterval(id);
  }, [flash]);
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: '#eef2ff', opacity: Animated.multiply(flash, strength) },
      ]}
    />
  );
}
