import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Box, Dot, Glow, Hotspot, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { Bike, Car, CarLights } from '@/art/Vehicles';
import { useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, HeaderDetail, Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { api, DESKS, type Me } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { cancelSessionEnd } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { seatsOf } from '@/world/seats';
import { useGo, useWorld } from '@/world/World';

const C = palette.carpark;

/**
 * Three even rows of four bays, and a rack slot each for bikes. Bay n and slot n
 * belong to whoever has desk n, so people park where they sit (you included).
 */
const ROW_TOPS = [256, 384, 512];
const BAY_W = 75;
const BAYS = Array.from({ length: DESKS }, (_, i) => ({
  x: 30 + (i % 4) * BAY_W + BAY_W / 2,
  y: ROW_TOPS[Math.floor(i / 4)] + 88,
}));
const RACK = Array.from({ length: DESKS }, (_, i) => ({ x: 22 + i * 9.6, y: 222 + (i % 2) * 6 }));
const WINDOW_XS = Array.from({ length: 94 }, (_, i) => -1956 + i * 46).filter(
  (x) => x + 30 < 138 || x > 222
);

export default function CarPark() {
  useAmbience('carpark');
  const { me, setMe, friends } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const onBreak = me.status === 'on_break';
  const atWork = me.status !== 'absent';
  const [leaving, setLeaving] = useState(false);

  // People at work park in the bay (or rack slot) that matches their desk.
  // Anyone without a vehicle walked, so the car park doesn't show them.
  const seats = seatsOf(me, friends);
  const cars = seats.flatMap((seat, i) =>
    seat?.vehicle && seat.vehicle !== 'bike' ? [{ seat, model: seat.vehicle, bay: BAYS[i] }] : []
  );
  const bikes = seats.flatMap((seat, i) =>
    seat?.vehicle === 'bike' ? [{ seat, slot: RACK[i] }] : []
  );
  const inCount = friends.filter((f) => f.status !== 'absent').length;

  const goHome = async () => {
    setLeaving(true);
    try {
      setMe(await api.goHome());
    } finally {
      setLeaving(false);
    }
  };

  const art = (
    <>
      {/* The office: flat roof, then the front wall with its windows and door. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={430} c={C.roof} />
      <Box x={BLEED.x} y={24} w={BLEED.w} h={6} c="#6c6058" />
      <Box x={BLEED.x} y={30} w={BLEED.w} h={122} c={C.wall} />
      {WINDOW_XS.map((x) => (
        <Box key={x} x={x} y={42} w={30} h={30} c={C.window} r={2} />
      ))}
      {WINDOW_XS.map((x) => (
        <Box key={`b${x}`} x={x} y={100} w={30} h={30} c={C.window} r={2} />
      ))}
      <Box x={150} y={56} w={60} h={14} c="#efe8da" r={2} />
      <Box x={136} y={76} w={88} h={8} c="#6f6259" r={2} />
      <Box x={144} y={84} w={72} h={68} c="#5d5650" r={2} />
      <Box x={148} y={88} w={31} h={64} c={C.glass} r={1} />
      <Box x={181} y={88} w={31} h={64} c={C.glass} r={1} />
      <Box x={174} y={114} w={3} h={12} c="#d9d4ca" r={1} />
      <Box x={183} y={114} w={3} h={12} c="#d9d4ca" r={1} />
      {/* noticeboard */}
      <Box x={238} y={94} w={54} h={36} c="#a4825e" r={2} />
      <Box x={242} y={98} w={46} h={28} c="#c49a6c" r={1} />
      {[
        [246, 101, '#efe8da'],
        [262, 104, '#e6d38f'],
        [274, 100, '#cfe0e6'],
        [252, 114, '#ead6d0'],
      ].map(([x, y, c]) => (
        <Box key={`${x}${y}`} x={x as number} y={y as number} w={11} h={9} c={c as string} />
      ))}

      {/* Pavement, bike rack and the hedge with the garden gate. */}
      <Box x={BLEED.x} y={152} w={BLEED.w} h={80} c={C.pavement} />
      <Box x={BLEED.x} y={232} w={BLEED.w} h={3} c="#8f8a82" />
      <Box x={16} y={190} w={118} h={3} c="#8b9096" r={1} />
      {RACK.map((s) => (
        <Box
          key={s.x}
          x={s.x - 3}
          y={185}
          w={6}
          h={9}
          r={3}
          style={{ borderWidth: 1.2, borderColor: '#8b9096' }}
        />
      ))}
      {bikes.map(({ seat, slot }) => (
        <Bike key={seat.username} x={slot.x} y={slot.y} />
      ))}
      <Box x={300} y={152} w={2100} h={80} c={C.hedge} />
      {[300, 324, 348, 372].map((x) => (
        <Dot key={x} x={x + 10} y={226} d={28} h={14} c="#557352" />
      ))}
      <Box x={308} y={160} w={36} h={56} c={onBreak ? '#b59a72' : '#9c8466'} r={2} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={312 + i * 8} y={164} w={4} h={48} c="#8a7154" />
      ))}

      {/* Three even rows of bays, and more of the car park past the stage. */}
      {[-330, 30, 390].map((x0) => (
        <Bays key={x0} x={x0} faint={x0 !== 30} />
      ))}
      {[-150, -280, 520, 650].map((x, i) => (
        <Tree key={x} x={x} y={300 + (i % 2) * 210} />
      ))}
      {cars.map(({ seat, model, bay }) => (
        <Car key={seat.username} model={model} x={bay.x} y={bay.y} />
      ))}

      <LampPost x={14} y={470} />
      <LampPost x={346} y={340} />
    </>
  );

  const glow = (
    <>
      {WINDOW_XS.map((x) => (
        <Box key={x} x={x} y={42} w={30} h={30} c={C.lit} r={2} o={0.85} />
      ))}
      {WINDOW_XS.filter((_, i) => i % 3 !== 1).map((x) => (
        <Box key={`b${x}`} x={x} y={100} w={30} h={30} c={C.lit} r={2} o={0.85} />
      ))}
      <Box x={148} y={88} w={64} h={64} c="#f6e2b4" o={0.8} />
      <Glow x={180} y={168} w={170} h={54} c="#f6dca0" o={0.5} />
      {[
        { x: 14, y: 470 },
        { x: 346, y: 340 },
      ].map((p) => (
        <Glow key={p.x} x={p.x} y={p.y - 6} w={150} h={64} c="#ffe2a0" o={0.45} />
      ))}
      {cars.map(({ seat, model, bay }) => (
        <CarLights key={seat.username} model={model} x={bay.x} y={bay.y} />
      ))}
    </>
  );

  const overlay = (
    <>
      <Hotspot
        x={140}
        y={80}
        w={80}
        h={74}
        label="Walk into the office"
        onPress={() => go('/office')}
      />
      <Tag x={180} y={156} text="Office" dim />
      <Hotspot
        x={234}
        y={90}
        w={62}
        h={44}
        label="Noticeboard: friends"
        onPress={() => go('/friends', null)}
      />
      <Hotspot
        x={300}
        y={154}
        w={52}
        h={66}
        label="Garden gate"
        disabled={!onBreak}
        onPress={() => go('/garden')}
      />
      {onBreak && <Tag x={326} y={204} text="Garden" dim />}
      {cars.map(({ seat, bay }) => (
        <Tag
          key={seat.username}
          x={bay.x}
          y={bay.y + 2}
          text={seat.isMe ? 'You' : seat.display_name}
        />
      ))}
      {bikes.map(({ seat, slot }, i) => (
        <Tag
          key={seat.username}
          x={slot.x}
          y={slot.y + 4 + (i % 2) * 12}
          text={seat.isMe ? 'You' : seat.display_name}
          dim
        />
      ))}
    </>
  );

  return (
    <Scene
      conditions={conditions}
      ground={C.ground}
      outdoor
      art={art}
      glow={glow}
      overlay={overlay}
      reserve={{ top: 56, bottom: 150 }}
    >
      <SceneHeader
        place="Car park"
        chips={me.chips}
        detail={<HeaderDetail>{conditions.label}</HeaderDetail>}
      />
      <Panel>
        <Greeting me={me} inCount={inCount} />
        <Button title="Walk in" onPress={() => go('/office')} />
        <View style={styles.row}>
          <Button
            title="Noticeboard"
            variant="quiet"
            small
            onPress={() => go('/friends', null)}
            style={styles.flex}
          />
          {onBreak && (
            <Button
              title="Garden"
              variant="quiet"
              small
              onPress={() => go('/garden')}
              style={styles.flex}
            />
          )}
          {atWork && (
            <Button
              title="Go home"
              variant="quiet"
              small
              onPress={goHome}
              disabled={leaving}
              style={styles.flex}
            />
          )}
        </View>
        <Button
          title="Log out"
          variant="ghost"
          small
          onPress={async () => {
            await cancelSessionEnd();
            await supabase.auth.signOut();
          }}
        />
      </Panel>
    </Scene>
  );
}

function Greeting({ me, inCount }: { me: Me; inCount: number }) {
  const tone = useTone();
  if (me.status === 'on_break' && me.break_ends_at) {
    return (
      <Body>
        {"You're on a break: "}
        <Countdown
          until={me.break_ends_at}
          minutes
          style={{ color: tone.text, fontWeight: '600' }}
        />
        {" left. The garden's through the gate."}
      </Body>
    );
  }
  const who =
    inCount === 0
      ? 'Nobody else is in yet.'
      : inCount === 1
        ? 'One friend is in.'
        : `${inCount} friends are in.`;
  return (
    <View style={{ gap: 2 }}>
      <Body>{who}</Body>
      <Muted>
        {me.vehicle
          ? `You came by ${itemInfo(me.vehicle).name.toLowerCase()}.`
          : 'You came on foot. The garden shed sells bikes.'}
      </Muted>
    </View>
  );
}

function LampPost({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x} y={y} w={16} />
      <Box x={x - 2} y={y - 58} w={4} h={58} c="#55595e" r={2} />
      <Box x={x - 8} y={y - 64} w={16} h={7} c="#4a4e53" r={3} />
    </>
  );
}

/** Three rows of four bays starting at `x`; faint ones are just scenery. */
function Bays({ x, faint }: { x: number; faint?: boolean }) {
  const o = faint ? 0.5 : 0.8;
  return (
    <>
      {ROW_TOPS.map((y) => (
        <Box key={y} x={x} y={y} w={4 * BAY_W} h={2} c={C.line} o={o} />
      ))}
      {ROW_TOPS.flatMap((y) =>
        [0, 1, 2, 3, 4].map((i) => (
          <Box key={`${y}-${i}`} x={x - 1 + i * BAY_W} y={y + 2} w={2} h={92} c={C.line} o={o} />
        ))
      )}
    </>
  );
}

function Tree({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 6} y={y + 30} w={74} />
      <Dot x={x} y={y} d={70} h={60} c={C.tree} />
      <Dot x={x - 12} y={y - 9} d={36} h={30} c="#7b9a70" />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
