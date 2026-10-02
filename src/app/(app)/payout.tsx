import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DESK_SPOTS, OfficeFloor, OfficeGlow } from '@/art/Office';
import { Box, Dot } from '@/art/primitives';
import { Scene, useTone, Zoom } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { RipeNote } from '@/components/RipeNote';
import { api } from '@/lib/api';
import { cancelSessionEnd } from '@/lib/notifications';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { seatsOf } from '@/world/seats';
import { markPayoutSeen, useGo, useWorld } from '@/world/World';

const STACK_HEIGHT = 8;
/** How much closer than the office view: your desk nearly fills the stage. */
const ZOOM = 3.5;
/** Where the front of your desk lands on the stage. */
const DESK_FRONT = { x: 180, y: 520 };
/** Its screen, in stage units at that zoom (see Desk in src/art/Office). */
const SCREEN = {
  x: DESK_FRONT.x - 17 * ZOOM,
  y: DESK_FRONT.y - 67 * ZOOM,
  w: 34 * ZOOM,
  h: 22 * ZOOM,
};

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
  for (const colour of chips) {
    const top = stacks[stacks.length - 1];
    if (top && top.length < STACK_HEIGHT && top[0] === colour) top.push(colour);
    else stacks.push([colour]);
  }
  return stacks;
}

export default function Payout() {
  useAmbience('office');
  const { me, friends, setMe } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const session = me.status === 'on_break' ? me.last_completed : null;
  const sessionId = session?.id;
  const earned = session?.chips ?? 0;
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

  // A closer look at your own desk in the office, just as it is out there.
  const seats = seatsOf(me, friends);
  const mine = Math.max(
    0,
    seats.findIndex((s) => s?.isMe)
  );
  const from = DESK_SPOTS[mine];

  let drawn = 0;
  const art = (
    <>
      <Zoom k={ZOOM} from={from} to={DESK_FRONT}>
        <OfficeFloor seats={seats} rain={conditions.weather.rain} closeUp={mine} />
      </Zoom>
      <ScreenDone />
      {stacks.map((stack, si) => {
        const x = DESK_FRONT.x + (si - (stacks.length - 1) / 2) * 38;
        return stack.map((colour, k) => {
          const visible = drawn++ < shown;
          return visible ? (
            <Chip key={`${si}-${k}`} x={x} y={DESK_FRONT.y - 52 - k * 5} colour={colour} />
          ) : null;
        });
      })}
    </>
  );
  const glow = (
    <>
      <Zoom k={ZOOM} from={from} to={DESK_FRONT}>
        <OfficeGlow seats={seats} closeUp={mine} />
      </Zoom>
      <ScreenDone />
    </>
  );

  if (!session) {
    return (
      <Scene conditions={conditions} ground={palette.office.ground} art={art} glow={glow}>
        <SceneHeader place="Office" chips={me.chips} />
        <Panel>
          <Body>{"There's nothing to collect right now."}</Body>
          <Button title="Back to the car park" onPress={() => go('/')} />
        </Panel>
      </Scene>
    );
  }

  return (
    <Scene
      conditions={conditions}
      ground={palette.office.ground}
      art={art}
      glow={glow}
      reserve={{ top: 56, bottom: 240 }}
    >
      <SceneHeader place="Session complete" chips={me.chips} />
      <Panel>
        <Earned earned={earned} minutes={session.duration_min} />
        {me.break_ends_at && <BreakEarned minutes={session.break_min} until={me.break_ends_at} />}
        <RipeNote ripe={me.ripe} style={styles.centerText} />
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

/** A full progress bar on your monitor: the session's done. */
function ScreenDone() {
  const { x, y, w, h } = SCREEN;
  return (
    <>
      <Box x={x + w * 0.15} y={y + h * 0.45} w={w * 0.7} h={8} c="#7fa6bb" r={4} />
      <Dot x={x + w / 2} y={y + h * 0.25} d={12} c="#7fa6bb" />
    </>
  );
}

function Earned({ earned, minutes }: { earned: number; minutes: number }) {
  const tone = useTone();
  const luck = earned - minutes;
  const note =
    luck > 0
      ? ` · ${luck} lucky chip${luck === 1 ? '' : 's'}`
      : luck < 0
        ? ` · ${-luck} rolled under the desk`
        : '';
  return (
    <View style={styles.center}>
      <Text style={[styles.earned, { color: tone.chip }]}>+{earned} chips</Text>
      <Muted>{`${minutes} minutes studied${note}`}</Muted>
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

/** A poker chip lying flat on the desk, seen from above and in front. */
function Chip({ x, y, colour }: { x: number; y: number; colour: string }) {
  return (
    <>
      <Dot x={x} y={y + 2.5} d={34} h={15} c="#2a2622" o={0.35} />
      <Dot x={x} y={y} d={34} h={15} c={colour} />
      <Dot x={x} y={y} d={25} h={10} c={palette.chips.edge} o={0.55} />
      <Dot x={x} y={y} d={19} h={7.5} c={colour} />
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
