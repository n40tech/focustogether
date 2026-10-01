import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AllotmentPlot,
  BED,
  Bench,
  bedOrigin,
  Hedge,
  PLOT,
  RaisedBed,
  Shed,
  WaterButt,
} from '@/art/Garden';
import { ChatBubble, Person } from '@/art/People';
import { Box, Dot, Glow, Hotspot, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { playSound, setSmoking, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import {
  BasketSheet,
  BedSheet,
  OffersSheet,
  SeedSheet,
  TradeSheet,
  type Act,
} from '@/components/GardenSheets';
import { usePolled } from '@/hooks/usePolled';
import { api, type Garden, type Gardener, type Plot } from '@/lib/api';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { MAX_SAY, useGardenChat } from '@/world/useGardenChat';
import { useGo, useWorld } from '@/world/World';

const G = palette.garden;

/** Friends' plots sit either side of the path; yours is at the front. */
const FRIEND_PLOTS = [
  { x: 22, y: 92 },
  { x: 214, y: 112 },
  { x: 22, y: 226 },
  { x: 214, y: 246 },
  { x: 22, y: 342 },
  { x: 214, y: 352 },
];
const MY_PLOT = { x: 121, y: 486 };

/** Where a friend stands: on the path beside their plot. */
const standingSpot = (p: { x: number; y: number }) => ({
  x: p.x < 180 ? p.x + PLOT.w + 14 : p.x - 14,
  y: p.y + PLOT.h - 2,
});
const ME = { x: MY_PLOT.x - 18, y: MY_PLOT.y + PLOT.h };

type SheetState =
  | { kind: 'seed'; bed: number }
  | { kind: 'bed'; plot: Plot }
  | { kind: 'basket' }
  | { kind: 'trade'; to?: string; give?: string }
  | { kind: 'offers' }
  | null;

export default function GardenScene() {
  useAmbience('garden');
  const world = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const polled = usePolled(api.getGarden, 5000);
  const setGarden = polled.setData;
  const garden = polled.data;
  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [breakOver, setBreakOver] = useState(false);

  const status = garden?.me.status ?? world.me.status;
  const breakEndsAt = garden?.me.break_ends_at ?? world.me.break_ends_at;
  const onBreak = status === 'on_break' && !breakOver;

  const neighbours = (garden?.neighbours ?? []).slice(0, FRIEND_PLOTS.length);
  const chat = useGardenChat(
    world.me.username,
    neighbours.map((n) => n.username)
  );

  const act: Act = useCallback(
    async (action, sound) => {
      try {
        setGarden(await action());
        if (sound) playSound(sound);
        setNotice(null);
        return true;
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [setGarden]
  );

  // The break timer ran out (or the server says so): ring the bell once.
  const refreshWorld = world.refresh;
  const ended = useRef(false);
  const endBreak = useCallback(() => {
    if (ended.current) return;
    ended.current = true;
    setBreakOver(true);
    setSheet(null);
    playSound('bell');
    refreshWorld();
  }, [refreshWorld]);
  useEffect(() => {
    if (status === 'idle') endBreak();
  }, [status, endBreak]);

  // A quiet crackle while your cigarette lasts.
  const smoking = garden?.me.activity === 'smoking';
  useEffect(() => {
    setSmoking(smoking);
    return () => setSmoking(false);
  }, [smoking]);

  // Rain waters your beds for you.
  const raining = conditions.weather.rain > 0.2;
  const dry = !!garden?.me.plots.some((p) => !p.watered);
  const rained = useRef(false);
  useEffect(() => {
    if (!raining || !dry || !onBreak || rained.current) return;
    rained.current = true;
    api
      .water()
      .then((g) => {
        setGarden(g);
        setNotice('The rain is watering your beds.');
      })
      .catch(() => {});
  }, [raining, dry, onBreak, setGarden]);

  const goHome = async () => {
    try {
      world.setMe(await api.goHome());
    } finally {
      go('/');
    }
  };

  const myPlots = garden?.me.plots ?? [];
  const wet = conditions.wet > 0.3;
  const incoming = garden?.trades.filter((t) => t.incoming) ?? [];
  const cigarettes = garden?.me.inventory.cigarette ?? 0;

  const onBed = (bed: number) => {
    if (!onBreak || !garden) return;
    const plot = myPlots.find((p) => p.bed === bed);
    if (!plot) return setSheet({ kind: 'seed', bed });
    if (plot.ripe) return void act(() => api.harvest(bed), 'pluck');
    setSheet({ kind: 'bed', plot });
  };

  const art = (
    <>
      <Hedge y={-400} h={460} />
      <Surroundings />
      <Box x={BLEED.x} y={56} w={BLEED.w} h={8} c={G.fence} />
      <Shed x={268} y={4} />
      {/* Gravel paths */}
      <Box x={166} y={64} w={28} h={400} c={G.path} />
      <Box x={BLEED.x} y={446} w={BLEED.w} h={22} c={G.path} />
      <Box x={BLEED.x} y={600} w={BLEED.w} h={22} c={G.path} o={0.6} />
      {neighbours.map((n, i) => (
        <AllotmentPlot
          key={n.username}
          x={FRIEND_PLOTS[i].x}
          y={FRIEND_PLOTS[i].y}
          plots={n.plots}
          wet={wet}
        />
      ))}
      {neighbours.map((n, i) =>
        n.status === 'on_break' ? (
          <FriendInGarden key={n.username} who={n} at={standingSpot(FRIEND_PLOTS[i])} />
        ) : null
      )}
      <AllotmentPlot x={MY_PLOT.x} y={MY_PLOT.y} plots={myPlots} wet={wet} />
      <WaterButt x={268} y={566} />
      {incoming.length > 0 && <Parcel x={262} y={496} />}
      <Bench x={14} y={586} />
      <Shadow x={330} y={626} w={50} />
      <Box x={312} y={590} w={36} h={34} c="#6d5a45" r={4} />
      {status !== 'absent' && (
        <Person
          username={world.me.username}
          x={ME.x}
          y={ME.y}
          activity={garden?.me.activity ?? null}
        />
      )}
    </>
  );

  const glow = (
    <>
      <Box x={276} y={50} w={16} h={14} c="#f3d9a6" />
      <Glow x={300} y={96} w={170} h={56} c="#f6dca0" o={0.45} />
    </>
  );

  const overlay = (
    <>
      {neighbours.map((n, i) => (
        <Tag
          key={n.username}
          x={FRIEND_PLOTS[i].x + PLOT.w / 2}
          y={FRIEND_PLOTS[i].y + PLOT.h + 1}
          text={n.display_name}
          dim={n.status !== 'on_break'}
        />
      ))}
      <Tag x={MY_PLOT.x + PLOT.w / 2} y={MY_PLOT.y + PLOT.h + 1} text="Your plot" />
      <Tag x={310} y={90} text="Shed" dim />
      {[0, 1, 2, 3].map((bed) => {
        const o = bedOrigin(MY_PLOT.x, MY_PLOT.y, bed);
        return (
          <Hotspot
            key={bed}
            x={o.x}
            y={o.y}
            w={BED.w}
            h={BED.h}
            label={`Bed ${bed + 1}`}
            onPress={() => onBed(bed)}
            disabled={!onBreak}
          />
        );
      })}
      <Hotspot
        x={266}
        y={2}
        w={88}
        h={86}
        label="Shed: spend chips"
        onPress={() => go('/shop?from=garden', null)}
      />
      <Hotspot
        x={254}
        y={536}
        w={30}
        h={32}
        label="Water your beds"
        disabled={!onBreak}
        onPress={() => act(() => api.water(), 'water')}
      />
      {incoming.length > 0 && (
        <Hotspot
          x={252}
          y={484}
          w={30}
          h={28}
          label="Offers for you"
          onPress={() => setSheet({ kind: 'offers' })}
        />
      )}
      {neighbours.map((n, i) => (
        <Hotspot
          key={n.username}
          x={FRIEND_PLOTS[i].x}
          y={FRIEND_PLOTS[i].y}
          w={PLOT.w}
          h={PLOT.h}
          label={`Offer ${n.display_name} a trade`}
          disabled={!onBreak}
          onPress={() => setSheet({ kind: 'trade', to: n.username })}
        />
      ))}
      {neighbours.map((n, i) => {
        const bubble = chat.bubbles[n.username];
        const at = standingSpot(FRIEND_PLOTS[i]);
        return bubble ? (
          <ChatBubble key={bubble.id} x={at.x} y={at.y - 44} text={bubble.text} ttl={bubble.ttl} />
        ) : null;
      })}
      {chat.bubbles[world.me.username] && (
        <ChatBubble
          key={chat.bubbles[world.me.username].id}
          x={ME.x}
          y={ME.y - 44}
          text={chat.bubbles[world.me.username].text}
          ttl={chat.bubbles[world.me.username].ttl}
        />
      )}
    </>
  );

  return (
    <Scene
      conditions={conditions}
      ground={G.ground}
      outdoor
      art={art}
      glow={glow}
      overlay={overlay}
      reserve={{ top: 56, bottom: onBreak ? 214 : 150 }}
    >
      <SceneHeader
        place="Garden"
        detail={onBreak && breakEndsAt ? <BreakLeft until={breakEndsAt} onDone={endBreak} /> : null}
      />
      {status === 'absent' ? (
        <Panel>
          <Body>{"The garden's for breaks. Finish a study session to earn one."}</Body>
          <Button title="Back to the car park" onPress={() => go('/')} />
        </Panel>
      ) : !onBreak ? (
        <Panel>
          <Body style={styles.center}>{"Break's over."}</Body>
          <Button title="Back to work" onPress={() => go('/office')} />
          <Button title="Go home" variant="quiet" onPress={goHome} />
        </Panel>
      ) : (
        <Panel>
          <ChatBar onSay={chat.say} />
          <View style={styles.row}>
            <Button
              title="Water"
              variant="quiet"
              small
              style={styles.flex}
              onPress={() => act(() => api.water(), 'water')}
            />
            <Button
              title={smoking ? 'Smoking' : 'Smoke'}
              accessibilityLabel={`Smoke a cigarette (${cigarettes} left)`}
              variant="quiet"
              small
              style={styles.flex}
              disabled={smoking || cigarettes === 0}
              onPress={() => act(() => api.smoke(), 'lighter')}
            />
            <Button
              title="Basket"
              variant="quiet"
              small
              style={styles.flex}
              onPress={() => setSheet({ kind: 'basket' })}
            />
            {incoming.length > 0 && (
              <Button
                title="Offers"
                variant="quiet"
                small
                style={styles.flex}
                onPress={() => setSheet({ kind: 'offers' })}
              />
            )}
          </View>
          {/* Always takes a line, so the scene doesn't jump when a notice appears. */}
          <Muted style={styles.center}>{notice ?? ' '}</Muted>
          <View style={styles.row}>
            <Button title="Back to work" small style={styles.flex} onPress={() => go('/office')} />
            <Button title="Go home" variant="ghost" small style={styles.flex} onPress={goHome} />
          </View>
        </Panel>
      )}
      {garden && sheet && (
        <GardenSheet
          sheet={sheet}
          garden={garden}
          act={act}
          setSheet={setSheet}
          onShop={() => go('/shop?from=garden', null)}
        />
      )}
    </Scene>
  );
}

function GardenSheet({
  sheet,
  garden,
  act,
  setSheet,
  onShop,
}: {
  sheet: NonNullable<SheetState>;
  garden: Garden;
  act: Act;
  setSheet: (s: SheetState) => void;
  onShop: () => void;
}) {
  const close = () => setSheet(null);
  switch (sheet.kind) {
    case 'seed':
      return (
        <SeedSheet bed={sheet.bed} garden={garden} act={act} onShop={onShop} onClose={close} />
      );
    case 'bed':
      return <BedSheet plot={sheet.plot} onClose={close} />;
    case 'basket':
      return (
        <BasketSheet
          garden={garden}
          act={act}
          onOffer={(give) => setSheet({ kind: 'trade', give })}
          onClose={close}
        />
      );
    case 'trade':
      return (
        <TradeSheet
          garden={garden}
          initialTo={sheet.to}
          initialGive={sheet.give}
          act={act}
          onClose={close}
        />
      );
    case 'offers':
      return <OffersSheet garden={garden} act={act} onClose={close} />;
  }
}

/** More allotments and trees past the stage edges, seen on wide screens. */
function Surroundings() {
  const beds = [-300, -230, 410, 480].flatMap((x) => [120, 260, 400].map((y) => ({ x, y })));
  return (
    <>
      {beds.map(({ x, y }, i) => (
        <RaisedBed
          key={`${x}-${y}`}
          x={x}
          y={y}
          wet={false}
          plot={i % 3 === 1 ? WILD : undefined}
        />
      ))}
      {[-120, 560].map((x) => (
        <Box key={x} x={x - 14} y={64} w={28} h={404} c={G.path} />
      ))}
      {[
        [-60, 560],
        [-250, 590],
        [440, 580],
        [620, 560],
      ].map(([x, y]) => (
        <TreeTop key={x} x={x} y={y} />
      ))}
    </>
  );
}

const WILD: Plot = {
  bed: 0,
  crop: 'sunflower',
  growth_min: 100,
  grow_min: 180,
  ripe: false,
  watered: true,
  planted_at: '',
};

function TreeTop({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 8} y={y + 34} w={86} />
      <Dot x={x} y={y} d={84} h={72} c="#5f7f56" />
      <Dot x={x - 14} y={y - 10} d={44} h={36} c="#6f9064" />
    </>
  );
}

function FriendInGarden({ who, at }: { who: Gardener; at: { x: number; y: number } }) {
  return <Person username={who.username} x={at.x} y={at.y} activity={who.activity} />;
}

/** A wooden crate by your plot: someone has offered you something. */
function Parcel({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 11} y={y + 16} w={30} />
      <Box x={x} y={y} w={22} h={16} c="#b08a5f" r={2} />
      <Box x={x} y={y + 6} w={22} h={2} c="#8d6c47" />
      <Dot x={x + 11} y={y + 1} d={10} h={5} c="#d1543f" />
    </>
  );
}

function BreakLeft({ until, onDone }: { until: string; onDone: () => void }) {
  const tone = useTone();
  return (
    <Text style={{ color: tone.muted, fontSize: 12 }}>
      {'· break '}
      <Countdown
        until={until}
        onDone={onDone}
        style={{ color: tone.text, fontSize: 12, fontVariant: ['tabular-nums'] }}
      />
    </Text>
  );
}

function ChatBar({ onSay }: { onSay: (text: string) => boolean }) {
  const tone = useTone();
  const [text, setText] = useState('');
  const send = () => {
    if (onSay(text)) setText('');
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Say something…"
        placeholderTextColor={tone.muted}
        maxLength={MAX_SAY}
        onSubmitEditing={send}
        returnKeyType="send"
        blurOnSubmit={false}
        style={[
          styles.input,
          { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
        ]}
      />
      <Button title="Say" small onPress={send} disabled={!text.trim()} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
});
