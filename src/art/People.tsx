import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import { useNow } from '@/hooks/useNow';
import { SMOKE_MINUTES, type Activity } from '@/lib/api';
import { paint, type Hairstyle, type Looks } from '@/lib/looks';
import { useLooksOf } from '@/world/World';
import { nativeDriver, rand, useLoop } from './motion';
import { Box, Dot, Shadow } from './primitives';

/**
 * A head seen from the front, centred at (x, y). The hair is one shape behind
 * it, and the face is cut out of that below the hairline, so the hair follows
 * the head's outline. Then any fringe, and the eyes.
 */
function HeadFront({
  x: cx,
  y: cy,
  style,
  skin,
  c,
}: {
  x: number;
  y: number;
  style: Hairstyle;
  skin: string;
  c: string;
}) {
  // On whole stage units, so both eyes come out the same shape wherever you stand.
  const x = Math.round(cx);
  const y = Math.round(cy);
  /** How far down the head the hair comes, from its top. */
  const hairline = { short: 4, long: 4, bun: 3.5, curly: 3, shaved: 0 }[style];
  return (
    <>
      {style !== 'shaved' && <Dot x={x} y={y - 2} d={16} c={c} />}
      {style === 'long' && <Box x={x - 8} y={y - 5} w={16} h={14} c={c} r={4} />}
      {style === 'bun' && <Dot x={x} y={y - 10.5} d={7} c={c} />}
      {style === 'curly' &&
        [0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Dot
            key={i}
            x={x + 7.5 * Math.cos(Math.PI * (1 + i / 6))}
            y={y - 2 + 7.5 * Math.sin(Math.PI * (1 + i / 6))}
            d={6}
            c={c}
          />
        ))}
      <Box x={x - 7} y={y - 7} w={14} h={14} r={7} style={{ overflow: 'hidden' }}>
        <Box x={0} y={hairline} w={14} h={14} c={skin} />
        {style === 'shaved' && <Box x={0} y={0} w={14} h={4} c={c} o={0.55} />}
        <Dot x={4} y={8} d={2} c="#2b2622" />
        <Dot x={10} y={8} d={2} c="#2b2622" />
      </Box>
      {style === 'short' && <Box x={x - 1} y={y - 4} w={9} h={3} c={c} r={1.5} />}
      {style === 'long' && (
        <>
          <Box x={x - 8} y={y - 4.5} w={7.5} h={3.5} c={c} r={2} />
          <Box x={x + 0.5} y={y - 4.5} w={7.5} h={3.5} c={c} r={2} />
        </>
      )}
      {style === 'curly' &&
        [-5.5, -2, 2, 5.5].map((dx) => (
          <Dot key={dx} x={x + dx} y={y - 3.5 - (Math.abs(dx) < 3 ? 0.5 : 0)} d={4.5} c={c} />
        ))}
    </>
  );
}

/** Hair seen from behind, on a head centred at (x, y). */
function HairBack({ x, y, style, c }: { x: number; y: number; style: Hairstyle; c: string }) {
  const cap = <Dot x={x} y={y - 2} d={15} h={13} c={c} />;
  switch (style) {
    case 'shaved':
      return <Dot x={x} y={y - 2} d={15} h={13} c={c} o={0.5} />;
    case 'long':
      return (
        <>
          {cap}
          <Box x={x - 7} y={y} w={14} h={11} c={c} r={4} />
        </>
      );
    case 'bun':
      return (
        <>
          {cap}
          <Dot x={x} y={y - 8} d={7} c={c} />
        </>
      );
    case 'curly':
      return (
        <>
          <Dot x={x} y={y - 2} d={17} h={15} c={c} />
          <Dot x={x - 7} y={y + 2} d={5} c={c} />
          <Dot x={x + 7} y={y + 2} d={5} c={c} />
        </>
      );
    default:
      return cap;
  }
}

/**
 * A person seen from above and in front. `x` is their centre, `y` where their
 * feet meet the ground. At a desk ('sit') they face away from us; on a bench
 * they face us. They look as they've chosen, unless `looks` says otherwise
 * (a preview).
 */
export function Person({
  username,
  x,
  y,
  pose = 'stand',
  activity = null,
  smokingUntil = null,
  basket = false,
  looks,
}: {
  username: string;
  x: number;
  y: number;
  pose?: 'stand' | 'sit' | 'bench';
  activity?: Activity;
  /** When their cigarette burns out: it gets shorter until then. */
  smokingUntil?: string | null;
  /** Carrying a basket: they've something on their stall. */
  basket?: boolean;
  looks?: Looks;
}) {
  const chosen = useLooksOf(username);
  const { shirt, skin, hair, style } = paint(looks ?? chosen);
  if (pose === 'bench') {
    // Sitting on a bench, facing us: lap and shins in front of the seat.
    return (
      <>
        <Shadow x={x} y={y} w={20} o={0.1} />
        <Box x={x - 9} y={y - 27} w={18} h={17} c={shirt} r={7} />
        <HeadFront x={x} y={y - 31} style={style} skin={skin} c={hair} />
        <Box x={x - 8} y={y - 13} w={16} h={6} c="#4a4d55" r={3} />
        <Box x={x - 6} y={y - 8} w={4} h={8} c="#4a4d55" r={2} />
        <Box x={x + 2} y={y - 8} w={4} h={8} c="#4a4d55" r={2} />
        {activity === 'smoking' && <Cigarette x={x + 7} y={y - 16} until={smokingUntil} />}
      </>
    );
  }
  if (pose === 'sit') {
    // From behind: shoulders and the back of the head.
    return (
      <>
        <Box x={x - 13} y={y - 20} w={26} h={20} c={shirt} r={9} />
        <Dot x={x} y={y - 24} d={15} c={skin} />
        <HairBack x={x} y={y - 24} style={style} c={hair} />
      </>
    );
  }
  return (
    <>
      <Shadow x={x} y={y} w={22} />
      <Box x={x - 5} y={y - 9} w={4} h={9} c="#4a4d55" r={2} />
      <Box x={x + 1} y={y - 9} w={4} h={9} c="#4a4d55" r={2} />
      <Box x={x - 9} y={y - 27} w={18} h={20} c={shirt} r={7} />
      <HeadFront x={x} y={y - 33} style={style} skin={skin} c={hair} />
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
      {activity === 'smoking' && <Cigarette x={x + 7} y={y - 22} until={smokingUntil} />}
    </>
  );
}

/**
 * A cigarette held at (x, y), burning down from the far end over its few
 * minutes; once it's burnt out there's nothing left to draw.
 */
function Cigarette({ x, y, until }: { x: number; y: number; until: string | null }) {
  const now = useNow(2000);
  const left = until ? (Date.parse(until) - now) / (SMOKE_MINUTES * 60_000) : 1;
  if (left <= 0) return null;
  const length = 2 + 6 * Math.min(1, left);
  return (
    <>
      <Box x={x} y={y} w={length} h={1.6} c="#efe9de" />
      <Box x={x} y={y} w={2} h={1.6} c="#c9a07a" />
      <Box x={x + length - 0.8} y={y} w={1} h={1.6} c="#8f8a84" />
      <Dot x={x + length} y={y + 0.8} d={2} c="#e0763c" />
      <Smoke x={x + length} y={y - 1} />
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
