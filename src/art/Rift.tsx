import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { Box, Glow } from './primitives';

const H = 72;
const W = 18;

/**
 * A rift in the garden, standing on (x, y): a tall dark tear with a pale
 * seam, opening upwards from the ground. It opens where your two devices
 * pulled you apart. With `fade`, it closes again after a few seconds.
 */
export function Rift({
  x,
  y,
  fade,
  reduceMotion,
}: {
  x: number;
  y: number;
  fade?: boolean;
  reduceMotion: boolean;
}) {
  const [open] = useState(() => new Animated.Value(reduceMotion ? 1 : 0));
  useEffect(() => {
    const steps = [
      Animated.timing(open, {
        toValue: 1,
        duration: reduceMotion ? 0 : 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ];
    if (fade)
      steps.push(
        Animated.delay(3000),
        Animated.timing(open, {
          toValue: 0,
          duration: reduceMotion ? 0 : 900,
          easing: Easing.in(Easing.quad),
          useNativeDriver: false,
        })
      );
    Animated.sequence(steps).start();
  }, [open, fade, reduceMotion]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityRole="image"
      accessibilityLabel="A rift"
      style={[
        styles.rift,
        {
          left: x - W * 2,
          top: y - H,
          opacity: open,
          // Grows up from the ground.
          transform: [{ translateY: H / 2 }, { scaleY: open }, { translateY: -H / 2 }],
        },
      ]}
    >
      <Glow x={W * 2} y={H * 0.55} w={W * 7} h={H * 1.3} c="#9d8bd6" o={0.55} />
      <Box x={W * 1.5} y={0} w={W} h={H} c="#1d1730" r={W / 2} />
      <Box x={W * 2 - 1.5} y={H * 0.12} w={3} h={H * 0.76} c="#d9ccf7" r={1.5} o={0.9} />
      <View style={styles.ground} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  rift: { position: 'absolute', width: W * 4, height: H },
  ground: {
    position: 'absolute',
    left: W * 0.8,
    bottom: -3,
    width: W * 2.4,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1d1730',
    opacity: 0.35,
  },
});
