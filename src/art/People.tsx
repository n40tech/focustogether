import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import type { Activity } from '@/lib/api';
import { personColour } from '@/lib/catalog';
import { nativeDriver, rand, useLoop } from './motion';
import { Box, Dot, Shadow } from './primitives';

const SKIN = ['#f0d0b4', '#dcae88', '#b47e57', '#7f5539'];
const HAIR = ['#3b2f2a', '#6b4a33', '#a37c4f', '#2d2d33', '#8a5a3c'];

function looks(username: string) {
  let h = 7;
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) | 0;
  const n = Math.abs(h);
  return {
    shirt: personColour(username),
    skin: SKIN[n % SKIN.length],
    hair: HAIR[(n >> 3) % HAIR.length],
  };
}

/**
 * A person seen from above and in front. `x` is their centre, `y` where their
 * feet meet the ground. Seated people face away from us, towards their desk.
 */
export function Person({
  username,
  x,
  y,
  pose = 'stand',
  activity = null,
  basket = false,
}: {
  username: string;
  x: number;
  y: number;
  pose?: 'stand' | 'sit';
  activity?: Activity;
  /** Carrying a basket: they've something on their stall. */
  basket?: boolean;
}) {
  const { shirt, skin, hair } = looks(username);
  if (pose === 'sit') {
    // From behind: shoulders and the back of the head.
    return (
      <>
        <Box x={x - 13} y={y - 20} w={26} h={20} c={shirt} r={9} />
        <Dot x={x} y={y - 24} d={15} c={skin} />
        <Dot x={x} y={y - 26} d={15} h={13} c={hair} />
      </>
    );
  }
  return (
    <>
      <Shadow x={x} y={y} w={22} />
      <Box x={x - 5} y={y - 9} w={4} h={9} c="#4a4d55" r={2} />
      <Box x={x + 1} y={y - 9} w={4} h={9} c="#4a4d55" r={2} />
      <Box x={x - 9} y={y - 27} w={18} h={20} c={shirt} r={7} />
      <Dot x={x} y={y - 33} d={14} c={skin} />
      <Box x={x - 7} y={y - 41} w={14} h={6} c={hair} r={5} />
      <Dot x={x - 3} y={y - 33} d={1.8} c="#2b2622" />
      <Dot x={x + 3} y={y - 33} d={1.8} c="#2b2622" />
      {basket && (
        <>
          <Box
            x={x - 16}
            y={y - 21}
            w={8}
            h={7}
            r={4}
            style={{ borderWidth: 1.2, borderColor: '#8d6c47' }}
          />
          <Box x={x - 18} y={y - 17} w={12} h={8} c="#b08a5f" r={2} />
          <Box x={x - 18} y={y - 14} w={12} h={1.2} c="#8d6c47" />
        </>
      )}
      {activity === 'smoking' && (
        <>
          <Box x={x + 7} y={y - 22} w={7} h={1.6} c="#efe9de" />
          <Dot x={x + 14} y={y - 21.2} d={2} c="#e0763c" />
          <Smoke x={x + 14} y={y - 23} />
        </>
      )}
    </>
  );
}

function Puff({ x, y, i }: { x: number; y: number; i: number }) {
  const t = useLoop(3200, { delay: i * 1050 });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x - 4,
        top: y - 4,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#e9ecef',
        opacity: t.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) },
          {
            translateX: t.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0, 3 + rand(i) * 3, -2],
            }),
          },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.8] }) },
        ],
      }}
    />
  );
}

/** Slow smoke rising from a cigarette. */
export function Smoke({ x, y }: { x: number; y: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <Puff key={i} x={x} y={y} i={i} />
      ))}
    </>
  );
}

/**
 * A Club Penguin-style speech bubble over someone's head. `x`, `y` is the top of
 * their head; the bubble fades in, then fades out after `ttl` ms.
 */
export function ChatBubble({
  x,
  y,
  text,
  ttl,
}: {
  x: number;
  y: number;
  text: string;
  ttl: number;
}) {
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: nativeDriver }),
      Animated.delay(Math.max(0, ttl - 900)),
      Animated.timing(fade, { toValue: 0, duration: 650, useNativeDriver: nativeDriver }),
    ]).start();
  }, [fade, ttl]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - 70,
        width: 140,
        bottom: 640 - y + 6,
        alignItems: 'center',
        opacity: fade,
        transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
      }}
    >
      <View
        style={{
          backgroundColor: '#fffdf8',
          borderRadius: 10,
          paddingHorizontal: 8,
          paddingVertical: 5,
          borderWidth: 1,
          borderColor: 'rgba(45, 43, 38, 0.18)',
          maxWidth: 140,
        }}
      >
        <Text style={{ fontSize: 11, lineHeight: 14, color: '#2d2b26', textAlign: 'center' }}>
          {text}
        </Text>
      </View>
      <View
        style={{
          width: 8,
          height: 8,
          marginTop: -5,
          backgroundColor: '#fffdf8',
          borderRightWidth: 1,
          borderBottomWidth: 1,
          borderColor: 'rgba(45, 43, 38, 0.18)',
          transform: [{ rotate: '45deg' }],
        }}
      />
    </Animated.View>
  );
}
