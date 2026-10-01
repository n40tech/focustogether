import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { api } from '@/lib/api';
import { cancelSessionEnd } from '@/lib/notifications';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { markPayoutSeen, useGo, useWorld } from '@/world/World';

const O = palette.office;
const STACK_HEIGHT = 8;

/**
 * Counts an amount out in poker chips, mostly red 5s so there's a proper pile:
 * 37 -> seven 5s and two 1s; anything over 50 comes partly in green 25s.
 */
function stacksFor(amount: number) {
  const greens = Math.floor(Math.max(0, amount - 50) / 25);
  const rest = amount - greens * 25;
  const chips = [
    ...Array<string>(greens).fill(palette.chips.green),
    ...Array<string>(Math.floor(rest / 5)).fill(palette.chips.red),
    ...Array<string>(rest % 5).fill(palette.chips.white),
  ];
  const stacks: string[][] = [];
  chips.forEach((colour, i) => {
    if (i % STACK_HEIGHT === 0 || colour !== chips[i - 1]) stacks.push([]);
    stacks[stacks.length - 1].push(colour);
  });
  return stacks;
}

export default function Payout() {
  useAmbience('office');
  const { me, setMe } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const session = me.status === 'on_break' ? me.last_completed : null;
  const sessionId = session?.id;
  const earned = session?.duration_min ?? 0;
  const stacks = useMemo(() => stacksFor(earned), [earned]);
  const physical = stacks.reduce((n, s) => n + s.length, 0);
  const [shown, setShown] = useState(0);
  const [busy, setBusy] = useState(false);

  // A chime, then the chips counted out onto the desk one by one.
  useEffect(() => {
    if (sessionId === undefined) return;
    markPayoutSeen(sessionId);
    playSound('chime');
    let n = 0;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      playSound('chips', { count: physical });
      id = setInterval(() => {
        n += 1;
        setShown(n);
        if (n >= physical && id) clearInterval(id);
      }, 95);
    }, 700);
    return () => {
      clearTimeout(start);
      if (id) clearInterval(id);
    };
  }, [sessionId, physical]);

  const goHome = async () => {
    setBusy(true);
    try {
      setMe(await api.goHome());
      cancelSessionEnd();
      go('/');
    } finally {
      setBusy(false);
    }
  };

  let drawn = 0;
  const art = (
    <>
      {/* Close up on your desk. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={1440} c={O.ground} />
      <Box x={-40} y={150} w={440} h={330} c={O.deskTop} r={8} />
      <Box x={-40} y={480} w={440} h={26} c={O.desk} r={4} />
      <Box x={30} y={170} w={110} h={70} c="#efe9df" r={3} o={0.9} />
      <Box x={40} y={182} w={80} h={4} c="#cfc6b6" />
      <Box x={40} y={194} w={66} h={4} c="#cfc6b6" />
      <Box x={40} y={206} w={74} h={4} c="#cfc6b6" />
      <Box x={276} y={201} w={36} h={44} c="#16181b" r={6} o={0.12} />
      <Box x={272} y={196} w={36} h={44} c="#ebe6dc" r={6} />
      <Dot x={290} y={198} d={30} h={12} c="#5b4030" />
      {stacks.map((stack, si) => {
        const x = 180 + (si - (stacks.length - 1) / 2) * 56;
        return stack.map((colour, k) => {
          const visible = drawn++ < shown;
          return visible ? <Chip key={`${si}-${k}`} x={x} y={400 - k * 7} colour={colour} /> : null;
        });
      })}
    </>
  );

  if (!session) {
    return (
      <Scene conditions={conditions} ground={O.ground} art={art}>
        <SceneHeader place="Office" chips={me.chips} />
        <Panel>
          <Body>{"There's nothing to collect right now."}</Body>
          <Button title="Back to the car park" onPress={() => go('/')} />
        </Panel>
      </Scene>
    );
  }

  return (
    <Scene conditions={conditions} ground={O.ground} art={art} reserve={{ top: 56, bottom: 240 }}>
      <SceneHeader place="Session complete" chips={me.chips} />
      <Panel>
        <Earned earned={earned} minutes={session.duration_min} />
        {me.break_ends_at && <BreakEarned minutes={session.break_min} until={me.break_ends_at} />}
        <Button title="Take a break" onPress={() => go('/garden')} />
        <View style={styles.row}>
          <Button
            title="Go home"
            variant="quiet"
            onPress={goHome}
            disabled={busy}
            style={styles.flex}
          />
          <Button
            title="Spend chips"
            variant="quiet"
            onPress={() => go('/shop?from=payout', null)}
            style={styles.flex}
          />
        </View>
      </Panel>
    </Scene>
  );
}

function Earned({ earned, minutes }: { earned: number; minutes: number }) {
  const tone = useTone();
  return (
    <View style={styles.center}>
      <Text style={[styles.earned, { color: tone.chip }]}>+{earned} chips</Text>
      <Muted>{`${minutes} minutes studied`}</Muted>
    </View>
  );
}

function BreakEarned({ minutes, until }: { minutes: number; until: string }) {
  const tone = useTone();
  return (
    <Body style={styles.centerText}>
      {`You've earned a ${minutes} min break. `}
      <Countdown until={until} minutes style={{ color: tone.muted }} />
      {' left.'}
    </Body>
  );
}

/** A poker chip lying flat, seen from above and in front. */
function Chip({ x, y, colour }: { x: number; y: number; colour: string }) {
  return (
    <>
      <Dot x={x} y={y + 3} d={46} h={20} c="#2a2622" o={0.35} />
      <Dot x={x} y={y} d={46} h={20} c={colour} />
      <Dot x={x} y={y} d={34} h={13} c={palette.chips.edge} o={0.55} />
      <Dot x={x} y={y} d={26} h={10} c={colour} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 2 },
  centerText: { textAlign: 'center' },
  earned: { fontSize: 30, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
