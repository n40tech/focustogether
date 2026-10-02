import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AllotmentPlot,
  Bench,
  Boundary,
  Compost,
  Hedge,
  MarketTable,
  PLOT,
  Shed,
  Sign,
  WaterButt,
} from '@/art/Garden';
import { ChatBubble, Person } from '@/art/People';
import { Box, Dot, Glow, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene, STAGE, useTone } from '@/art/Scene';
import { playSound, setSmoking, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Panel, SceneHeader, Toast } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import {
  BasketSheet,
  BedSheet,
  FriendSheet,
  SeedSheet,
  StallSheet,
  TradeSheet,
  type Act,
} from '@/components/GardenSheets';
import { Joystick } from '@/components/Joystick';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { api, BEDS, type Garden, type Gardener, type Plot } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import {
  bedRect,
  BENCHES,
  besidePlot,
  BUTTS,
  COMPOST,
  dist,
  distToRect,
  FENCE_Y,
  GATE,
  HEDGE_Y,
  MARKET,
  obstaclesFor,
  onGravel,
  PATH,
  plotRect,
  plotSpots,
  SHED,
  SHED_DOOR,
  STALLS,
  TABLES,
  WORLD,
  type Point,
} from '@/world/gardenMap';
import { type Bubble, MAX_SAY, POS_EVERY_MS, useGardenChannel } from '@/world/useGardenChannel';
import { useWalker } from '@/world/useWalker';
import { Whereabouts } from '@/world/whereabouts';
import { useGo, useWorld } from '@/world/World';

const G = palette.garden;

/** How close counts as "next to": a friend, one of your beds, a friend's plot, the shed door, the market. */
const REACH = { person: 46, bed: 24, plot: 24, shed: 34, market: 30 };
/** Footsteps are this far apart (yours and, heard over the channel, friends'). */
const STRIDE = 26;

/**
 * Where you were standing, so popping into the shed doesn't send you back to
 * the gate. Kept for the rest of that break.
 */
let lastSpot: { username: string; breakEndsAt: string | null; at: Point } | null = null;

type Near =
  | { kind: 'friend'; username: string }
  | { kind: 'bed'; bed: number }
  | { kind: 'friendPlot'; username: string }
  | { kind: 'shed' }
  | { kind: 'market' };

const sameNear = (a: Near | null, b: Near | null) => JSON.stringify(a) === JSON.stringify(b);

type SheetState =
  | { kind: 'seed'; bed: number }
  | { kind: 'bed'; plot: Plot }
  | { kind: 'basket' }
  | { kind: 'trade'; to?: string; give?: string; fixedTo?: boolean }
  | { kind: 'stall'; item?: string }
  | { kind: 'friend'; username: string }
  | null;

export default function GardenScene() {
  useAmbience('garden');
  const world = useWorld();
  const me = world.me;
  const conditions = useConditions();
  const go = useGo();
  const reduceMotion = useReducedMotion();
  // For ripe crops going over (once a minute is plenty).
  const now = useNow(60_000);
  const polled = usePolled(api.getGarden, 5000);
  const setGarden = polled.setData;
  const garden = polled.data;
  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [breakOver, setBreakOver] = useState(false);
  const [viewWidth, setViewWidth] = useState<number>(STAGE.width);
  const [near, setNear] = useState<Near | null>(null);

  const status = garden?.me.status ?? me.status;
  const breakEndsAt = garden?.me.break_ends_at ?? me.break_ends_at;
  const onBreak = status === 'on_break' && !breakOver;
  const neighbours = useMemo(() => garden?.neighbours ?? [], [garden]);

  // Everyone's plots, always in the same places; friends' appear as you add them.
  const spots = useMemo(
    () =>
      garden
        ? plotSpots([{ username: me.username, plot_slot: garden.me.plot_slot }, ...neighbours])
        : new Map<string, Point>(),
    [garden, neighbours, me.username]
  );
  const obstacles = useMemo(() => obstaclesFor([...spots.values()]), [spots]);
  const onStage = useCallback((s: { viewWidth: number }) => setViewWidth(s.viewWidth), []);

  // --- walking -------------------------------------------------------------

  const [start] = useState(() =>
    lastSpot?.username === me.username && lastSpot.breakEndsAt === me.break_ends_at
      ? lastSpot.at
      : GATE
  );
  const moved = useRef<() => void>(() => {});
  const onStep = useCallback((at: Point) => playSound(onGravel(at) ? 'gravel' : 'step'), []);
  const onMove = useCallback(() => moved.current(), []);
  const walker = useWalker({
    start,
    obstacles,
    viewWidth,
    reduceMotion,
    paused: !onBreak || sheet !== null,
    onStep,
    onMove,
  });
  const where = walker.where;
  useEffect(
    () => () => {
      lastSpot = { username: me.username, breakEndsAt: me.break_ends_at, at: where() };
    },
    [me.username, me.break_ends_at, where]
  );

  // Friends' footsteps: quieter further off, and from their side of you.
  const [whereabouts] = useState(() => new Whereabouts());
  const friendMoved = useCallback(
    (username: string, at: Point) => {
      if (!whereabouts.set(username, at, STRIDE)) return;
      const you = where();
      const gain = Math.max(0, 1 - dist(at, you) / 420) ** 2;
      if (gain < 0.03) return;
      const pan = Math.max(-0.8, Math.min(0.8, (at.x - you.x) / 300));
      playSound(onGravel(at) ? 'gravel' : 'step', { gain: gain * 0.7, pan });
    },
    [whereabouts, where]
  );

  const friendNames = useMemo(() => neighbours.map((n) => n.username), [neighbours]);
  const chat = useGardenChannel(me.username, friendNames, onBreak && !!garden, {
    onMove: friendMoved,
    where,
  });
  useEffect(() => {
    moved.current = chat.moved;
  }, [chat.moved]);

  // Friends in the garden with you: on a break (says the server), and here (say they).
  const around = useMemo(
    () => neighbours.filter((n) => n.status === 'on_break' && chat.present.includes(n.username)),
    [neighbours, chat.present]
  );

  // What you're standing next to, checked a few times a second.
  useEffect(() => {
    if (!onBreak || !garden) return;
    const check = () => {
      const next = nearest(where(), me.username, garden, spots, around, whereabouts);
      setNear((prev) => (sameNear(prev, next) ? prev : next));
    };
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, [onBreak, garden, spots, around, whereabouts, where, me.username]);

  // --- garden actions ------------------------------------------------------

  const act: Act = useCallback(
    async (action, sound) => {
      try {
        setGarden(await action());
        if (sound) playSound(sound);
        setNotice(null);
        return true;
      } catch (e) {
        say(e instanceof Error ? e.message : String(e));
        return false;
      }
    },
    [setGarden, say]
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
        say('The rain is watering your beds.');
      })
      .catch(() => {});
  }, [raining, dry, onBreak, setGarden, say]);

  const goHome = async () => {
    try {
      world.setMe(await api.goHome());
    } finally {
      go('/');
    }
  };

  // --- the scene -----------------------------------------------------------

  const myPlots = garden?.me.plots ?? [];
  const myStall = garden?.me.stall ?? [];
  const wet = conditions.wet > 0.3;
  const incoming = garden?.trades.filter((t) => t.incoming) ?? [];
  const cigarettes = garden?.me.inventory.cigarette ?? 0;
  const myPlot = spots.get(me.username);
  // The market tables show what's on the stalls of whoever's in the garden.
  const goods = [
    ...new Set(
      [...(onBreak ? myStall : []), ...around.flatMap((n) => n.stall)].map(
        (l) => itemInfo(l.item).colour
      )
    ),
  ];
  const homeOf = (username: string) => {
    const plot = spots.get(username);
    return plot ? besidePlot(plot) : GATE;
  };
  const plotsOf = (username: string) =>
    username === me.username
      ? myPlots
      : (neighbours.find((n) => n.username === username)?.plots ?? []);

  const art = (
    <Pan by={walker.pan}>
      <Hedge y={-400} h={FENCE_Y + 404} />
      <Box x={BLEED.x} y={FENCE_Y} w={BLEED.w} h={8} c={G.fence} />
      <Box x={PATH.x} y={PATH.y} w={PATH.w} h={PATH.h} c={G.path} />
      <Box x={MARKET.x} y={MARKET.y} w={MARKET.w} h={MARKET.h} c={G.path} o={0.75} r={8} />
      {[...spots.entries()].map(([username, at]) => (
        <AllotmentPlot
          key={username}
          x={at.x}
          y={at.y}
          plots={plotsOf(username)}
          wet={wet}
          now={now}
        />
      ))}
      {myPlot && incoming.length > 0 && <Parcel x={myPlot.x + PLOT.w + 8} y={myPlot.y + 62} />}
      <Shed x={SHED.x} y={SHED.y} />
      {BUTTS.map((b) => (
        <WaterButt key={b.x} x={b.x} y={b.y} />
      ))}
      {BENCHES.map((b) => (
        <Bench key={b.x} x={b.x} y={b.y} />
      ))}
      <Compost x={COMPOST.x} y={COMPOST.y} />
      <Sign x={MARKET.x + 10} y={MARKET.y + 12} />
      {TABLES.map((t, i) => (
        <MarketTable key={t.x} x={t.x} y={t.y} goods={goods.slice(i * 3, i * 3 + 3)} />
      ))}
      {around.map((n) => (
        <Follow
          key={n.username}
          whereabouts={whereabouts}
          who={n.username}
          home={homeOf(n.username)}
        >
          <Person
            username={n.username}
            x={0}
            y={0}
            activity={n.activity}
            basket={n.stall.length > 0}
          />
        </Follow>
      ))}
      {onBreak && (
        <Animated.View
          pointerEvents="none"
          style={[styles.figure, { transform: walker.pos.getTranslateTransform() }]}
        >
          <Person
            username={me.username}
            x={0}
            y={0}
            activity={garden?.me.activity ?? null}
            basket={myStall.length > 0}
          />
        </Animated.View>
      )}
      <Boundary y={HEDGE_Y} gateX={GATE.x} width={WORLD.w} />
      <Surroundings />
    </Pan>
  );

  const glow = (
    <Pan by={walker.pan}>
      <Box x={SHED.x + 8} y={SHED.y + 46} w={16} h={14} c="#f3d9a6" />
      <Glow x={SHED.x + 16} y={SHED.y + 62} w={140} h={50} c="#f6dca0" o={0.45} />
    </Pan>
  );

  const myBubble = chat.bubbles[me.username];
  const overlay = (
    <Pan by={walker.pan}>
      {[...spots.entries()].map(([username, at]) => {
        const friend = neighbours.find((n) => n.username === username);
        return (
          <Tag
            key={username}
            x={at.x + PLOT.w / 2}
            y={at.y - 17}
            text={friend ? friend.display_name : 'Your plot'}
            dim={!!friend && !around.includes(friend)}
          />
        );
      })}
      <Tag x={SHED.x + 42} y={SHED.y - 16} text="Shed" dim />
      <Tag x={MARKET.x + MARKET.w / 2} y={MARKET.y + 4} text="Market" dim />
      {around.map((n) => (
        <Follow
          key={n.username}
          whereabouts={whereabouts}
          who={n.username}
          home={homeOf(n.username)}
        >
          <Label name={n.display_name} bubble={chat.bubbles[n.username]} />
        </Follow>
      ))}
      {onBreak && (
        <Animated.View
          pointerEvents="none"
          style={[styles.figure, { transform: walker.pos.getTranslateTransform() }]}
        >
          <Label name="You" bubble={myBubble} />
        </Animated.View>
      )}
    </Pan>
  );

  // What you can do where you're standing.
  const actions: { title: string; onPress: () => void; quiet?: boolean }[] = [];
  let hint = 'Walk up to your plot, a friend, the market or the shed.';
  if (near && garden) {
    switch (near.kind) {
      case 'friend': {
        const f = neighbours.find((n) => n.username === near.username);
        if (f)
          actions.push({
            title:
              f.stall.length > 0 ? `${f.display_name}'s stall` : `Trade with ${f.display_name}`,
            onPress: () => setSheet({ kind: 'friend', username: f.username }),
          });
        break;
      }
      case 'bed': {
        const plot = myPlots.find((p) => p.bed === near.bed);
        const info = plot && itemInfo(plot.crop);
        if (!plot || !info) {
          actions.push({
            title: 'Plant something',
            onPress: () => setSheet({ kind: 'seed', bed: near.bed }),
          });
        } else if (plot.withered) {
          actions.push({
            title: `Clear the withered ${(info.plural ?? info.name).toLowerCase()}`,
            onPress: () => void act(() => api.clearBed(near.bed), 'rustle'),
          });
        } else if (plot.ripe) {
          actions.push({
            title: `Harvest the ${(info.plural ?? info.name).toLowerCase()}`,
            onPress: () => void act(() => api.harvest(near.bed), 'pluck'),
          });
        } else {
          const share = Math.min(99, Math.floor((100 * plot.growth_min) / plot.grow_min));
          actions.push({
            title: `${info.name} · ${share}%`,
            quiet: true,
            onPress: () => setSheet({ kind: 'bed', plot }),
          });
        }
        // Watering (all your beds) goes alongside planting or looking at a
        // bed; picking and clearing need the room for their labels.
        if ((!plot || (!plot.ripe && !plot.withered)) && myPlots.some((p) => !p.watered))
          actions.push({
            title: 'Water',
            quiet: true,
            onPress: () => void act(() => api.water(), 'water'),
          });
        break;
      }
      case 'friendPlot': {
        const f = neighbours.find((n) => n.username === near.username);
        if (!f) break;
        if (f.plots.some((p) => !p.watered))
          actions.push({
            title: `Water ${f.display_name}'s beds`,
            onPress: () => void act(() => api.waterFriend(f.username), 'water'),
          });
        else
          hint =
            f.plots.length > 0
              ? `${f.display_name}'s beds are watered.`
              : `${f.display_name}'s plot. Nothing planted yet.`;
        break;
      }
      case 'shed':
        actions.push({ title: 'Go into the shed', onPress: () => go('/shop?from=garden', null) });
        break;
      case 'market':
        actions.push({ title: 'Your stall', onPress: () => setSheet({ kind: 'stall' }) });
        break;
    }
  }

  return (
    <Scene
      conditions={conditions}
      ground={G.ground}
      outdoor
      art={art}
      glow={glow}
      overlay={overlay}
      onStage={onStage}
      reserve={{ top: 56, bottom: onBreak ? 260 : 150 }}
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
          <View style={styles.controls}>
            <Joystick size={92} onChange={walker.steer} />
            <View style={styles.side}>
              <View style={styles.nearby}>
                {actions.length > 0 ? (
                  actions.map((a) => (
                    <Button
                      key={a.title}
                      title={a.title}
                      small
                      variant={a.quiet ? 'quiet' : 'primary'}
                      style={styles.flex}
                      onPress={a.onPress}
                    />
                  ))
                ) : (
                  <Muted style={styles.hint} numberOfLines={2}>
                    {hint}
                  </Muted>
                )}
              </View>
              <View style={styles.row}>
                <Button
                  title={smoking ? 'Smoking' : 'Smoke'}
                  accessibilityLabel={`Smoke a cigarette (${cigarettes} left)`}
                  variant="quiet"
                  small
                  style={styles.grow}
                  disabled={smoking || cigarettes === 0}
                  onPress={() => act(() => api.smoke(), 'lighter')}
                />
                <Button
                  title={incoming.length > 0 ? `Basket · ${incoming.length}` : 'Basket'}
                  accessibilityLabel={
                    incoming.length > 0
                      ? `Your basket, and ${incoming.length} offers for you`
                      : 'Your basket'
                  }
                  variant="quiet"
                  small
                  style={styles.grow}
                  onPress={() => setSheet({ kind: 'basket' })}
                />
                <Button
                  title="Stall"
                  accessibilityLabel="Your market stall"
                  variant="quiet"
                  small
                  style={styles.grow}
                  onPress={() => setSheet({ kind: 'stall' })}
                />
              </View>
            </View>
          </View>
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
      {notice && <Toast key={notice.id} text={notice.text} onDone={clearNotice} />}
    </Scene>
  );
}

/** The nearest thing you could do something with, if any. */
function nearest(
  at: Point,
  me: string,
  garden: Garden,
  spots: Map<string, Point>,
  around: Gardener[],
  whereabouts: Whereabouts
): Near | null {
  let best: Near | null = null;
  let bestDistance = Infinity;
  const consider = (candidate: Near, d: number, reach: number) => {
    if (d < reach && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  };

  // People first: if a friend's beside you, that's who you'll want.
  for (const n of around) {
    const p = whereabouts.get(n.username);
    if (p) consider({ kind: 'friend', username: n.username }, dist(at, p), REACH.person);
  }
  if (best) return best;

  const mine = spots.get(me);
  if (mine) {
    for (let bed = 0; bed < BEDS; bed++)
      consider({ kind: 'bed', bed }, distToRect(at, bedRect(mine, bed)), REACH.bed);
    if (best) return best;
  }
  for (const n of garden.neighbours) {
    const p = spots.get(n.username);
    if (p)
      consider(
        { kind: 'friendPlot', username: n.username },
        distToRect(at, plotRect(p)),
        REACH.plot
      );
  }
  consider({ kind: 'shed' }, dist(at, SHED_DOOR), REACH.shed);
  consider({ kind: 'market' }, distToRect(at, STALLS), REACH.market);
  return best;
}

/** Moves the garden under the stage as the camera pans. */
function Pan({ by, children }: { by: Animated.Value; children: ReactNode }) {
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.world, { transform: [{ translateX: by }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** Draws its children at a friend's position, easing between the positions they send. */
function Follow({
  whereabouts,
  who,
  home,
  children,
}: {
  whereabouts: Whereabouts;
  who: string;
  /** Where to stand them until we hear where they are. */
  home: Point;
  children: ReactNode;
}) {
  const [at] = useState(() => new Animated.ValueXY(whereabouts.get(who) ?? home));
  useEffect(
    () =>
      whereabouts.watch(who, (to) => {
        Animated.timing(at, {
          toValue: to,
          duration: POS_EVERY_MS + 60,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      }),
    [whereabouts, who, at]
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.figure, { transform: at.getTranslateTransform() }]}
    >
      {children}
    </Animated.View>
  );
}

/** A name under someone's feet, and what they're saying over their head. */
function Label({ name, bubble }: { name: string; bubble?: Bubble }) {
  return (
    <>
      <Tag x={0} y={5} text={name} />
      {bubble && <ChatBubble key={bubble.id} x={0} y={-44} text={bubble.text} ttl={bubble.ttl} />}
    </>
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
          onSell={(item) => setSheet({ kind: 'stall', item })}
          onClose={close}
        />
      );
    case 'trade':
      return (
        <TradeSheet
          garden={garden}
          initialTo={sheet.to}
          initialGive={sheet.give}
          fixedTo={sheet.fixedTo}
          act={act}
          onClose={close}
        />
      );
    case 'stall':
      return <StallSheet garden={garden} initialItem={sheet.item} act={act} onClose={close} />;
    case 'friend':
      return (
        <FriendSheet
          garden={garden}
          username={sheet.username}
          act={act}
          onSwap={() => setSheet({ kind: 'trade', to: sheet.username, fixedTo: true })}
          onClose={close}
        />
      );
  }
}

/** Trees and other people's allotments past the hedges, seen on wide screens. */
function Surroundings() {
  return (
    <>
      {[
        [-260, 140],
        [-200, 420],
        [-330, 600],
        [1300, 120],
        [1240, 400],
        [1380, 590],
      ].map(([x, y]) => (
        <TreeTop key={`${x}-${y}`} x={x} y={y} />
      ))}
    </>
  );
}

function TreeTop({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 8} y={y + 34} w={86} />
      <Dot x={x} y={y} d={84} h={72} c="#5f7f56" />
      <Dot x={x - 14} y={y - 10} d={44} h={36} c="#6f9064" />
    </>
  );
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
  world: { position: 'absolute', left: 0, top: 0, width: WORLD.w, height: STAGE.height },
  figure: { position: 'absolute', left: 0, top: 0, width: STAGE.width, height: STAGE.height },
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  controls: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  side: { flex: 1, gap: 8 },
  nearby: { flexDirection: 'row', gap: 6, height: 38, alignItems: 'center' },
  hint: { flex: 1, fontSize: 12, lineHeight: 16 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
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
