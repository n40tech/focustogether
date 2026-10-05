import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AllotmentPlot,
  Bench,
  Bin,
  Boundary,
  GardenNoticeboard,
  Hedge,
  MarketTable,
  PLOT,
  PostBox,
  Shed,
  Sign,
} from '@/art/Garden';
import { ChatBubble, Person } from '@/art/People';
import { Box, Dot, Glow, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene, STAGE, useTone } from '@/art/Scene';
import { playSound, setSmoking, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Panel, SceneHeader, Sheet, Toast } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import {
  BasketSheet,
  BedSheet,
  BinSheet,
  FriendSheet,
  isDry,
  plantsLabel,
  PostSheet,
  SeedSheet,
  StallSheet,
  TradeSheet,
  type Act,
} from '@/components/GardenSheets';
import { Joystick } from '@/components/Joystick';
import { Noticeboard } from '@/components/Noticeboard';
import { Tip, useTips } from '@/components/Tip';
import { useNow } from '@/hooks/useNow';
import { usePolled } from '@/hooks/usePolled';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { api, BEDS, PLANTS_PER_BED, type Garden, type Gardener } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { serverNow } from '@/lib/clock';
import { onTimeSkipped } from '@/lib/testing';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import {
  bedRect,
  BENCHES,
  besidePlot,
  binRect,
  BINS,
  dist,
  distToRect,
  FENCE_Y,
  GATE,
  GATE_OUT_Y,
  HEDGE_Y,
  MARKET,
  NOTICEBOARD,
  obstaclesFor,
  onGravel,
  PATH,
  plotRect,
  plotSpots,
  POSTBOX,
  SEATS,
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

/** How close counts as "next to" each thing you can do something with. */
const REACH = {
  person: 46,
  bed: 24,
  plot: 24,
  shed: 34,
  market: 30,
  post: 34,
  board: 30,
  bins: 28,
  seat: 20,
};
/** Footsteps are this far apart (yours and, heard over the channel, friends'). */
const STRIDE = 26;
/** About this many steps and you've got the hang of walking. */
const STEPS_TO_LEARN = 8;

/**
 * Where you were standing, so popping into the shed doesn't send you back to
 * the gate. Kept for the rest of that break.
 */
let lastSpot: { username: string; breakEndsAt: string | null; at: Point } | null = null;

/** A place you can do something at. */
type Place =
  | { kind: 'bed'; bed: number }
  | { kind: 'friendPlot'; username: string }
  | { kind: 'shed' }
  | { kind: 'market' }
  | { kind: 'post' }
  | { kind: 'board' }
  | { kind: 'bins' }
  | { kind: 'seat'; seat: number };

/** What's beside you: a place, a friend, both or neither. */
type Near = { place: Place | null; friend: string | null };

const NOWHERE: Near = { place: null, friend: null };
const sameNear = (a: Near, b: Near) => JSON.stringify(a) === JSON.stringify(b);

/** The noticeboard on its posts, for "am I next to it?". */
const BOARD = { x: NOTICEBOARD.x, y: NOTICEBOARD.y, w: 52, h: 48 };

type SheetState =
  | { kind: 'seed'; bed: number }
  | { kind: 'bed'; bed: number }
  | { kind: 'basket' }
  | { kind: 'trade'; to?: string; give?: string; fixedTo?: boolean }
  | { kind: 'stall'; item?: string }
  | { kind: 'friend'; username: string }
  | { kind: 'post' }
  | { kind: 'board' }
  | { kind: 'bins' }
  | null;

/** True until a cigarette lit until `until` burns out. */
function useLit(until: string | null | undefined) {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const id = setTimeout(() => setOut(until), Math.max(0, Date.parse(until) - serverNow()));
    return () => clearTimeout(id);
  }, [until]);
  return !!until && out !== until;
}

export default function GardenScene() {
  useAmbience('garden');
  const world = useWorld();
  const me = world.me;
  const conditions = useConditions();
  const go = useGo();
  const reduceMotion = useReducedMotion();
  const tips = useTips();
  // For ripe crops going over (once a minute is plenty).
  const now = useNow(60_000);
  const polled = usePolled(api.getGarden, 5000);
  const setGarden = polled.setData;
  const garden = polled.data;
  const refreshGarden = polled.refresh;
  useEffect(() => onTimeSkipped(() => void refreshGarden()), [refreshGarden]);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);
  const clearNotice = useCallback(() => setNotice(null), []);
  const [breakOver, setBreakOver] = useState(false);
  const [viewWidth, setViewWidth] = useState<number>(STAGE.width);
  const [near, setNear] = useState<Near>(NOWHERE);

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
  // Sitting on a bench: which seat (see SEATS), until you walk off.
  const [seat, setSeat] = useState<number | null>(null);
  const seated = useRef<number | null>(null);
  const moved = useRef<() => void>(() => {});
  const leftByGate = useRef(false);
  const steps = useRef(0);
  const learnt = useRef(tips.has('walk'));
  const doneTip = useRef(tips.done);
  useEffect(() => {
    doneTip.current = tips.done;
    learnt.current = tips.has('walk');
  });

  const onStep = useCallback((at: Point) => {
    playSound(onGravel(at) ? 'gravel' : 'step');
    steps.current += 1;
    if (!learnt.current && steps.current >= STEPS_TO_LEARN) {
      learnt.current = true;
      doneTip.current('walk');
    }
  }, []);
  const onMove = useCallback(
    (at: Point) => {
      if (seated.current !== null) setSeat(null);
      moved.current();
      // Out through the gate: back to work.
      if (at.y > GATE_OUT_Y && !leftByGate.current) {
        leftByGate.current = true;
        go('/office');
      }
    },
    [go]
  );
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
      const at = where();
      lastSpot = {
        username: me.username,
        breakEndsAt: me.break_ends_at,
        at: at.y > HEDGE_Y ? GATE : at,
      };
    },
    [me.username, me.break_ends_at, where]
  );

  // Friends' footsteps (quieter further off, and from their side of you), and
  // who's sitting down.
  const [whereabouts] = useState(() => new Whereabouts());
  const [sitting, setSitting] = useState<string[]>([]);
  const friendMoved = useCallback(
    (username: string, at: Point, sat: boolean) => {
      setSitting((list) =>
        list.includes(username) === sat
          ? list
          : sat
            ? [...list, username]
            : list.filter((u) => u !== username)
      );
      if (!whereabouts.set(username, at, STRIDE)) return;
      const you = where();
      const gain = Math.max(0, 1 - dist(at, you) / 420) ** 2;
      if (gain < 0.03) return;
      const pan = Math.max(-0.8, Math.min(0.8, (at.x - you.x) / 300));
      playSound(onGravel(at) ? 'gravel' : 'step', { gain: gain * 0.7, pan });
    },
    [whereabouts, where]
  );
  const isSitting = useCallback(() => seated.current !== null, []);

  const friendNames = useMemo(() => neighbours.map((n) => n.username), [neighbours]);
  const chat = useGardenChannel(me.username, friendNames, onBreak && !!garden, {
    onMove: friendMoved,
    where,
    sitting: isSitting,
  });
  useEffect(() => {
    moved.current = chat.moved;
  }, [chat.moved]);

  // Sitting down or getting up: friends see it straight away.
  useEffect(() => {
    seated.current = seat;
    moved.current();
  }, [seat]);
  const sitDown = (i: number) => {
    setSeat(i);
    walker.place(SEATS[i]);
  };
  const standUp = () => setSeat(null);

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
  const water = async () => {
    if (await act(() => api.water(), 'water')) tips.done('water');
  };

  // You're in the garden now: friends see your desk empty until you're back.
  const setMe = world.setMe;
  useEffect(() => {
    if (onBreak) api.setPlace('garden').then(setMe, () => {});
  }, [onBreak, setMe]);

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

  // A quiet crackle while your cigarette lasts; it burns out by itself.
  const smoking = useLit(garden?.me.activity === 'smoking' ? garden.me.activity_until : null);
  useEffect(() => {
    setSmoking(smoking);
    return () => setSmoking(false);
  }, [smoking]);

  // Rain waters your beds for you.
  const raining = conditions.weather.rain > 0.2;
  const dry = !!garden?.me.plots.some(isDry);
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
      go('/');
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };

  const onPickedUp = world.refresh;
  const onPosted = useCallback(
    (to: string) => {
      tips.done('post');
      const name = neighbours.find((n) => n.username === to)?.display_name ?? to;
      say(`Posted. It's waiting for ${name} in the post box.`);
    },
    [tips, neighbours, say]
  );

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
      {BENCHES.map((b) => (
        <Bench key={b.x} x={b.x} y={b.y} />
      ))}
      {BINS.map((b, i) => (
        <Bin key={b.x} x={b.x} y={b.y} colour={i === 0 ? '#4f6b55' : '#56636e'} />
      ))}
      <GardenNoticeboard x={NOTICEBOARD.x} y={NOTICEBOARD.y} />
      <PostBox x={POSTBOX.x} y={POSTBOX.y} waiting={me.letters > 0} />
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
            pose={sitting.includes(n.username) ? 'bench' : 'stand'}
            activity={n.activity}
            smokingUntil={n.activity_until}
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
            pose={seat !== null ? 'bench' : 'stand'}
            activity={garden?.me.activity ?? null}
            smokingUntil={garden?.me.activity_until}
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
      <Tag x={NOTICEBOARD.x + 26} y={NOTICEBOARD.y - 18} text="Noticeboard" dim />
      <Tag x={POSTBOX.x} y={POSTBOX.y - 62} text="Post box" dim={me.letters === 0} />
      {BINS.map((b) => (
        <Tag key={b.x} x={b.x + 12} y={b.y - 50} text="Bin" dim />
      ))}
      <Tag x={GATE.x + 84} y={HEDGE_Y + 8} text="Gate: back to work" dim />
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

  // What you can do where you're standing: at a place, with a friend beside
  // you, or both (neither hides the other).
  const actions: { title: string; label?: string; onPress: () => void; quiet?: boolean }[] = [];
  let hint = 'Walk up to your plot, a friend, the market, the post box or the shed.';
  const place = garden ? near.place : null;
  if (place) {
    switch (place.kind) {
      case 'bed': {
        const plants = myPlots.filter((p) => p.bed === place.bed);
        const ripe = plants.filter((p) => p.ripe);
        const withered = plants.filter((p) => p.withered);
        const look = () => setSheet({ kind: 'bed', bed: place.bed });
        if (ripe.length > 0) {
          actions.push({
            title: `Pick ${plantsLabel(ripe)}`,
            onPress: () => void act(() => api.harvest(place.bed), 'pluck'),
          });
        } else if (withered.length > 0) {
          actions.push({
            title: withered.length === 1 ? 'Clear the withered plant' : 'Clear the withered',
            onPress: () => void act(() => api.clearBed(place.bed), 'rustle'),
          });
        } else if (plants.length < PLANTS_PER_BED) {
          actions.push({
            title: plants.length === 0 ? 'Plant something' : 'Plant more',
            onPress: () => setSheet({ kind: 'seed', bed: place.bed }),
          });
        }
        // Then one quieter thing: water if anything's dry, else a closer look.
        if (myPlots.some(isDry)) actions.push({ title: 'Water', quiet: true, onPress: water });
        else if (plants.length > 0)
          actions.push({
            title: actions.length === 0 ? `Look at ${plantsLabel(plants)}` : 'Look',
            quiet: true,
            onPress: look,
          });
        if (actions.length < 2 && plants.length > 0 && myPlots.some(isDry))
          actions.push({ title: 'Look', quiet: true, onPress: look });
        break;
      }
      case 'friendPlot': {
        const f = neighbours.find((n) => n.username === place.username);
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
      case 'post':
        actions.push({
          title:
            me.letters > 0
              ? `Post box · ${me.letters} for you`
              : neighbours.length > 0
                ? 'Write a letter'
                : 'Post box',
          onPress: () => setSheet({ kind: 'post' }),
        });
        break;
      case 'board':
        actions.push({ title: 'Noticeboard', onPress: () => setSheet({ kind: 'board' }) });
        break;
      case 'bins':
        actions.push({ title: 'Throw something away', onPress: () => setSheet({ kind: 'bins' }) });
        break;
      case 'seat':
        if (seat === null)
          actions.push({ title: 'Sit on the bench', onPress: () => sitDown(place.seat) });
        else actions.push({ title: 'Stand up', quiet: true, onPress: standUp });
        break;
    }
  }
  const friend =
    garden && near.friend ? neighbours.find((n) => n.username === near.friend) : undefined;
  if (friend) {
    // Room for the place's main thing and the friend; only one stands out.
    actions.splice(1);
    const label =
      friend.stall.length > 0
        ? `${friend.display_name}'s stall`
        : `Trade with ${friend.display_name}`;
    actions.push({
      // Beside a place's button, just their name, so both fit.
      title: actions.length > 0 ? friend.display_name : label,
      label,
      quiet: actions.some((a) => !a.quiet),
      onPress: () => setSheet({ kind: 'friend', username: friend.username }),
    });
  }

  // One tip at a time for new players, in the order they'll want them.
  const hasSeeds = Object.keys(garden?.me.inventory ?? {}).some(
    (slug) => itemInfo(slug).kind === 'seed'
  );
  const tip: { id: string; text: string } | null = !garden
    ? null
    : !tips.has('walk')
      ? {
          id: 'walk',
          text: 'Drag the stick (or use the arrow keys) to walk. Your plot is marked "Your plot". Walk out through the gate to go back to work.',
        }
      : myPlots.length === 0 && !hasSeeds && !tips.has('seeds')
        ? { id: 'seeds', text: "You'll need seeds to plant: the shed, bottom left, sells them." }
        : myPlots.length === 0 && hasSeeds && !tips.has('plant')
          ? {
              id: 'plant',
              text: `Walk up to one of your beds to plant. Each seed makes one plant, and a bed holds ${PLANTS_PER_BED}.`,
            }
          : myPlots.some(isDry) && !tips.has('water')
            ? {
                id: 'water',
                text: 'Water your beds and they grow half as fast again for a day. Crops grow in real time, studying or not.',
              }
            : neighbours.length > 0 && !tips.has('post')
              ? {
                  id: 'post',
                  text: 'Leave a friend a letter in the post box, bottom right. It waits there until they come by.',
                }
              : null;

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
          {tip && <Tip id={tip.id}>{tip.text}</Tip>}
          <ChatBar onSay={chat.say} />
          <View style={styles.controls}>
            <View style={styles.side}>
              <View style={styles.nearby}>
                {actions.length > 0 ? (
                  actions.map((a) => (
                    <Button
                      key={a.label ?? a.title}
                      title={a.title}
                      accessibilityLabel={a.label}
                      small
                      variant={a.quiet ? 'quiet' : 'primary'}
                      style={styles.fit}
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
            {/* On the right, under your thumb. */}
            <Joystick size={92} onChange={walker.steer} />
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
          onPlanted={() => tips.done('plant')}
          onPickedUp={onPickedUp}
          onPosted={onPosted}
        />
      )}
      {notice && <Toast key={notice.id} text={notice.text} onDone={clearNotice} />}
    </Scene>
  );
}

/** The nearest thing you could do something with, and the nearest friend, if any. */
function nearest(
  at: Point,
  me: string,
  garden: Garden,
  spots: Map<string, Point>,
  around: Gardener[],
  whereabouts: Whereabouts
): Near {
  let friend: string | null = null;
  let closest = REACH.person;
  for (const n of around) {
    const p = whereabouts.get(n.username);
    const d = p ? dist(at, p) : Infinity;
    if (d < closest) {
      friend = n.username;
      closest = d;
    }
  }

  let best: Place | null = null;
  let bestDistance = Infinity;
  const consider = (candidate: Place, d: number, reach: number) => {
    if (d < reach && d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  };

  // Your own beds first: at your plot, that's what you'll want.
  const mine = spots.get(me);
  if (mine) {
    for (let bed = 0; bed < BEDS; bed++)
      consider({ kind: 'bed', bed }, distToRect(at, bedRect(mine, bed)), REACH.bed);
    if (best) return { place: best, friend };
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
  consider({ kind: 'post' }, dist(at, POSTBOX), REACH.post);
  consider({ kind: 'board' }, distToRect(at, BOARD), REACH.board);
  for (const b of BINS) consider({ kind: 'bins' }, distToRect(at, binRect(b)), REACH.bins);
  // Either side of a bench, or in front of it: the seat on your side.
  BENCHES.forEach((b, i) => {
    const seat = 2 * i + (at.x < b.x + 30 ? 0 : 1);
    consider(
      { kind: 'seat', seat },
      distToRect(at, { x: b.x, y: b.y - 6, w: 60, h: 24 }),
      REACH.seat
    );
  });
  return { place: best, friend };
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
  onPlanted,
  onPickedUp,
  onPosted,
}: {
  sheet: NonNullable<SheetState>;
  garden: Garden;
  act: Act;
  setSheet: (s: SheetState) => void;
  onShop: () => void;
  onPlanted: () => void;
  onPickedUp: () => void;
  onPosted: (to: string) => void;
}) {
  const close = () => setSheet(null);
  switch (sheet.kind) {
    case 'seed':
      return (
        <SeedSheet
          bed={sheet.bed}
          garden={garden}
          act={act}
          onPlanted={onPlanted}
          onShop={onShop}
          onClose={close}
        />
      );
    case 'bed':
      return (
        <BedSheet
          bed={sheet.bed}
          garden={garden}
          act={act}
          onPlant={() => setSheet({ kind: 'seed', bed: sheet.bed })}
          onClose={close}
        />
      );
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
    case 'post':
      return (
        <PostSheet
          friends={garden.neighbours}
          onPickedUp={onPickedUp}
          onPosted={onPosted}
          onClose={close}
        />
      );
    case 'board':
      return (
        <Sheet title="Noticeboard" onClose={close}>
          <Noticeboard />
        </Sheet>
      );
    case 'bins':
      return <BinSheet garden={garden} act={act} onClose={close} />;
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
  /** Side by side, each as wide as its words, sharing what's left. */
  fit: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
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
