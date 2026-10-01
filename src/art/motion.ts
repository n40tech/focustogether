import { useEffect, useState } from 'react';
import { Animated, Easing, Platform } from 'react-native';

export const nativeDriver = Platform.OS !== 'web';

/** A value that runs 0 → 1 over `duration` ms, forever (after `delay`). */
export function useLoop(duration: number, { delay = 0, paused = false } = {}) {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (paused) return;
    value.setValue(0);
    const loop = Animated.loop(
      Animated.timing(value, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.linear,
        useNativeDriver: nativeDriver,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [value, duration, delay, paused]);
  return value;
}

/** Deterministic pseudo-random numbers in [0, 1) for stable placements. */
export function rand(i: number, salt = 0) {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
