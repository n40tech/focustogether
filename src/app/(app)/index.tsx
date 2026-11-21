import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Person } from '@/art/People';
import { Box, Dot, Faint, Glow, Hotspot, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene, STAGE, useTone } from '@/art/Scene';
import { Bike, Car, CarLights } from '@/art/Vehicles';
import { playSound, setSmoking, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, HeaderDetail, Muted, Panel, SceneHeader, Sheet, Toast } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { FriendOfFriendSheet } from '@/components/FriendOfFriendSheet';
import { HomeScreenTip, useHomeScreenTip } from '@/components/HomeScreenTip';
import { RipeNote } from '@/components/RipeNote';
import { Steering } from '@/components/Steering';
import { INVITE_TIP, Tip, useTips } from '@/components/Tip';
import { ChatBar, Follow, Label, Pan, useLit, walkabout } from '@/components/Walkabout';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { api, CRASH_SPEED, type Crash, type Me, type Parked } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { cancelSessionEnd } from '@/lib/notifications';
import { turnOff } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import {
  BAY_H,
  BAY_W,
  bayPose,
  BAYS_PER_ROW,
  BAYS_X,
  besideVehicle,
  blockedOnFoot,
  BOARD,
  clampToCarPark,
  DOOR,
  ENTRANCE,
  GATE,
  HEDGE_X,
  hitsPole,
  isBike,
  LAMPS,
  offRoad,
  overlaps,
  parkingSpot,
  RACK,
  RACK_SLOTS,
  ROW_TOPS,
  shapeOf,
  slotPose,
  throughDoor,
  throughGate,
  WALL_Y,
  WORLD,
} from '@/world/carParkMap';
import { dist, type Point } from '@/world/gardenMap';
import { seatsOf } from '@/world/seats';
import { type Extra, useGardenChannel, type Where } from '@/world/useGardenChannel';
import { type Driving, useWalker } from '@/world/useWalker';
import { Whereabouts } from '@/world/whereabouts';
import { nameFor, useGo, useWorld } from '@/world/World';

const C = palette.carpark;

/** After a rift in the garden (see the garden screen): why you're here. */
const RIFT_NOTE =
  'You were walked two ways at once, on two devices, and a rift opened in the garden. You landed back in the car park.';

/** The car park's channels: "carpark:<username>" and "carpark-chat:<username>". */
const CHANNELS: Where = { prefix: 'carpark', clamp: clampToCarPark };

/** How close counts as "next to" something. */
const REACH = { door: 34, board: 34, gate: 30, vehicle: 22 };
/** Footsteps are this far apart. */
const STRIDE = 26;
/** Slower than this, you've stopped, and can park. */
const STOPPED = 6;

const WINDOW_XS = Array.from({ length: 94 }, (_, i) => -1956 + i * 46).filter(
  (x) => x + 30 < 138 || x > 222
);

/** How far down from a bike's middle its rider's feet are drawn, so they sit astride it. */
const RIDER_Y = 12;

/** A parked vehicle, as you see it. */
type Vehicle = {
  username: string;
  /** "You", a friend's name, or "Alice's friend". */
  name: string;
  model: string;
  at: Parked;
  health: number;
  mine: boolean;
  /** A friend of a friend's: see-through, and you drive (and walk) through it. */
  via?: string[];
};

/** What's beside you. */
type Near =
  | { kind: 'door' }
  | { kind: 'board' }
  | { kind: 'gate' }
  | { kind: 'vehicle'; username: string }
  | null;

/**
 * Where someone's vehicle is if they came before parking was a thing: the bay
 * (or rack slot) that matches their desk.
 */
function bayFor(model: string, slot: number): Parked {
  return isBike(model) ? slotPose(slot) : bayPose(slot, model);
}

/** Your car or your bike. */
const kindOf = (model: string) => (isBike(model) ? 'bike' : 'car');

/** Where you start: driving in from the side, walking in, out of the office, or back from the garden. */
function startFor(me: Me) {
  const canDrive = !!me.vehicle && me.vehicle_health > 0;
  if (me.status === 'absent')
    return canDrive
      ? { at: { x: ENTRANCE.x, y: ENTRANCE.y }, heading: ENTRANCE.a, driving: true }
      : { at: { x: 348, y: ENTRANCE.y + 30 }, heading: 0, driving: false };
  if (me.place === 'garden') return { at: GATE, heading: 0, driving: false };
  return { at: DOOR, heading: 0, driving: false };
}

export default function CarPark() {
  useAmbience('carpark');
  const { me, setMe, friends, friendsOfFriends, revealed, refresh } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const reduceMotion = useReducedMotion();
  const tips = useTips();
  const onBreak = me.status === 'on_break';
  const atWork = me.status !== 'absent';
  const [leaving, setLeaving] = useState(false);
  const [notice, setNotice] = useState<{ id: number; text: string } | null>(null);
  // A vehicle you tapped (or looked at): its owner's username.
  const [looking, setLooking] = useState<string | null>(null);
  const clearNotice = useCallback(() => setNotice(null), []);
  const { rift } = useLocalSearchParams<{ rift?: string }>();
  const router = useRouter();
  // Just joined, on a phone: adding it to the home screen comes before anything else.
  const homeScreenTip = useHomeScreenTip(me.sessions_done === 0);
  const say = useCallback((text: string) => setNotice({ id: Date.now(), text }), []);
  const sayError = useCallback(
    (e: unknown) => say(e instanceof Error ? e.message : String(e)),
    [say]
  );
  const [viewWidth, setViewWidth] = useState<number>(STAGE.width);
  const onStage = useCallback((s: { viewWidth: number }) => setViewWidth(s.viewWidth), []);

  const [start] = useState(() => startFor(me));
  const [driving, setDriving] = useState(start.driving);
  const drivingRef = useRef(driving);
  useEffect(() => {
    drivingRef.current = driving;
  }, [driving]);
  const myModel = me.vehicle;
  const canDrive = !!myModel && me.vehicle_health > 0;
  // Where you've just parked, ahead of the server saying so.
  const [myParked, setMyParked] = useState<Parked | null>(null);

  // You're out here now: friends see your desk empty until you're back.
  const placeNow = me.place;
  const studying = me.status === 'focused';
  useEffect(() => {
    if (atWork && !studying && placeNow !== 'outside')
      api.setPlace('outside').then(setMe, () => {});
    // Only as you come out here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- friends out here ---------------------------------------------------

  const [whereabouts] = useState(() => new Whereabouts());
  /** Friends driving about right now (heard over the channel). */
  const [drivers, setDrivers] = useState<string[]>([]);
  /** Where friends got out, until the server's heard where they parked. */
  const [parkedLive, setParkedLive] = useState<Record<string, Parked>>({});
  const lastPose = useRef(new Map<string, Parked>());

  // --- vehicles --------------------------------------------------------------

  const seats = useMemo(
    () => seatsOf(me, friends, friendsOfFriends),
    [me, friends, friendsOfFriends]
  );
  const vehicles = useMemo(() => {
    const list: Vehicle[] = [];
    const slotOf = (username: string) => seats.findIndex((s) => s?.username === username);
    const add = (
      p: { username: string; vehicle: string | null; vehicle_health: number },
      parked: Parked | null,
      name: string,
      mine: boolean,
      via?: string[]
    ) => {
      if (!p.vehicle) return;
      const slot = slotOf(p.username);
      const at = parked ?? (slot >= 0 ? bayFor(p.vehicle, slot) : null);
      if (at)
        list.push({
          username: p.username,
          name,
          model: p.vehicle,
          at,
          health: p.vehicle_health,
          mine,
          via,
        });
    };
    if (atWork) add(me, myParked ?? me.parked, 'You', true);
    friends
      .filter((f) => f.status !== 'absent')
      .forEach((f) => add(f, parkedLive[f.username] ?? f.parked, f.display_name, false));
    friendsOfFriends.forEach((f) =>
      add(f, parkedLive[f.username] ?? f.parked, nameFor(f, revealed), false, f.via)
    );
    return list;
  }, [atWork, me, myParked, friends, friendsOfFriends, parkedLive, revealed, seats]);
  // Parked ones: not yours while you drive it, nor friends' while they drive theirs.
  const parked = useMemo(
    () => vehicles.filter((v) => (v.mine ? !driving : !drivers.includes(v.username))),
    [vehicles, driving, drivers]
  );
  // What you can bump into: friends' parked vehicles (and, on foot, yours).
  const solid = useMemo(() => parked.filter((v) => !v.via), [parked]);
  const mine = vehicles.find((v) => v.mine);

  // --- walking and driving ---------------------------------------------------

  const moved = useRef<() => void>(() => {});
  const pose = useRef<() => Parked>(() => ENTRANCE);
  // Walking or parking out here is arriving: told to the server once.
  const [arrived, setArrived] = useState(atWork);
  const gone = useRef(false);
  const lastHit = useRef(new Map<string, number>());

  const onStep = useCallback(() => playSound('step'), []);
  const onMove = useCallback(
    (at: Point) => {
      moved.current();
      if (gone.current || drivingRef.current) return;
      // Walking about is arriving, if you came on foot.
      if (!arrived) {
        setArrived(true);
        api.setPlace('outside').then(setMe, () => {});
      }
      if (throughDoor(at)) {
        gone.current = true;
        go('/office');
      } else if (onBreak && throughGate(at)) {
        gone.current = true;
        go('/garden');
      }
    },
    [go, onBreak, setMe, arrived]
  );

  const onHit = useCallback(
    (what: string, speed: number) => {
      if (what === 'wall' || speed < CRASH_SPEED) return;
      if (what === 'pole') {
        const now = Date.now();
        if (now - (lastHit.current.get(what) ?? 0) < 3000) return;
        lastHit.current.set(what, now);
        playSound('crunch');
        api.bump(speed).then((next) => {
          setMe(next);
          say('Bang. You drove into a lamp post.');
        }, sayError);
        return;
      }
      const now = Date.now();
      if (now - (lastHit.current.get(what) ?? 0) < 3000) return;
      lastHit.current.set(what, now);
      playSound('crunch');
      const theirs = solid.find((v) => v.username === what);
      api.crash(what, speed).then((next) => {
        setMe(next);
        if (!theirs) return;
        const model = itemInfo(theirs.model).name.toLowerCase();
        say(`Crunch. You drove into ${theirs.name}'s ${model}.`);
      }, sayError);
    },
    [solid, setMe, say, sayError]
  );

  const drive: Driving | null = useMemo(
    () =>
      driving && myModel
        ? {
            model: myModel,
            collide: (next) => {
              const now = pose.current();
              // Already in a tight spot: let them drive out of it.
              if (offRoad(myModel, next) && !offRoad(myModel, now)) return 'wall';
              if (hitsPole(myModel, next) && !hitsPole(myModel, now)) return 'pole';
              const hit = solid.find(
                (v) =>
                  !v.mine &&
                  overlaps(myModel, next, v.model, v.at) &&
                  !overlaps(myModel, now, v.model, v.at)
              );
              return hit?.username ?? null;
            },
            onHit,
          }
        : null,
    [driving, myModel, solid, onHit]
  );
  const blocks = useCallback(
    (p: Point) =>
      blockedOnFoot(
        p,
        solid.map((v) => ({ model: v.model, at: v.at })),
        onBreak
      ),
    [solid, onBreak]
  );
  const walker = useWalker({
    start: start.at,
    heading: start.heading,
    blocks,
    worldWidth: WORLD.w,
    driving: drive,
    viewWidth,
    reduceMotion,
    paused: looking !== null || leaving,
    onStep,
    onMove,
  });
  const where = walker.where;
  const facing = walker.facing;
  useEffect(() => {
    pose.current = () => ({ ...where(), a: facing() });
  }, [where, facing]);

  // Friends walking (and driving) about: their footsteps, and who's in a car.
  const friendMoved = useCallback(
    (username: string, at: Point, _sat: boolean, extra: Extra) => {
      const car = extra.car === 1;
      if (car) lastPose.current.set(username, { x: at.x, y: at.y, a: extra.a ?? 0 });
      setDrivers((list) => {
        if (list.includes(username) === car) return list;
        if (!car) {
          // Just got out: their vehicle stays where they left it.
          const left = lastPose.current.get(username);
          if (left) setParkedLive((p) => ({ ...p, [username]: left }));
          return list.filter((u) => u !== username);
        }
        return [...list, username];
      });
      if (!whereabouts.set(username, { ...at, ...(car && { a: extra.a ?? 0 }) }, STRIDE) || car)
        return;
      const you = where();
      const gain = Math.max(0, 1 - dist(at, you) / 420) ** 2;
      if (gain < 0.03) return;
      playSound('step', {
        gain: gain * 0.7,
        pan: Math.max(-0.8, Math.min(0.8, (at.x - you.x) / 300)),
      });
    },
    [whereabouts, where]
  );
  // You on another device: there too, in your vehicle or not.
  const follow = walker.follow;
  const selfMoved = useCallback(
    (at: Point, _sat: boolean, _walking: boolean, extra: Extra) => {
      if (walker.steering()) return;
      follow(at, 0);
      if ((extra.car === 1) !== drivingRef.current) setDriving(extra.car === 1);
    },
    [walker, follow]
  );

  const friendNames = useMemo(
    () => friends.filter((f) => f.status !== 'absent').map((f) => f.username),
    [friends]
  );
  const strangerNames = useMemo(() => friendsOfFriends.map((f) => f.username), [friendsOfFriends]);
  const chat = useGardenChannel(
    me.username,
    friendNames,
    strangerNames,
    !studying,
    {
      onMove: friendMoved,
      onSelf: selfMoved,
      onRift: () => {},
      where,
      sitting: () => false,
      steering: walker.steering,
      extra: () => (drivingRef.current ? { car: 1, a: Math.round(facing() * 100) / 100 } : {}),
    },
    CHANNELS
  );
  useEffect(() => {
    moved.current = chat.moved;
  }, [chat.moved]);
  // Getting in or out: friends see it straight away.
  useEffect(() => {
    moved.current();
  }, [driving]);

  const around = friends.filter(
    (f) =>
      f.status !== 'absent' && chat.present.includes(f.username) && !drivers.includes(f.username)
  );
  const strangersAround = friendsOfFriends.filter(
    (f) => chat.present.includes(f.username) && !drivers.includes(f.username)
  );
  const friendsDriving = vehicles.filter((v) => !v.mine && drivers.includes(v.username));

  // What you're next to, checked a few times a second.
  const [near, setNear] = useState<Near>(null);
  useEffect(() => {
    const check = () => {
      const at = where();
      let next: Near = null;
      if (!drivingRef.current) {
        if (dist(at, DOOR) < REACH.door) next = { kind: 'door' };
        else if (dist(at, BOARD) < REACH.board) next = { kind: 'board' };
        else if (onBreak && dist(at, GATE) < REACH.gate) next = { kind: 'gate' };
        else {
          let best = Infinity;
          for (const v of parked) {
            const d = dist(at, v.at) - shapeOf(v.model).h / 2;
            if (d < REACH.vehicle && d < best) {
              best = d;
              next = { kind: 'vehicle', username: v.username };
            }
          }
        }
      }
      setNear((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, [where, parked, onBreak]);

  // --- getting in and out ----------------------------------------------------

  // Where you'd park if you stopped here: a free bay, or a free slot in the rack.
  const [spot, setSpot] = useState<Parked | null>(null);
  const [stopped, setStopped] = useState(true);
  useEffect(() => {
    if (!driving || !myModel) return;
    // Friends of friends' vehicles take up a bay too.
    const others = parked.filter((v) => !v.mine);
    const check = () => {
      const next = parkingSpot(myModel, { ...where(), a: facing() }, others);
      setSpot((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setStopped(Math.abs(walker.driven()) <= STOPPED);
    };
    check();
    const id = setInterval(check, 200);
    return () => clearInterval(id);
  }, [driving, myModel, parked, where, facing, walker]);

  const park = useCallback(
    async (at: Parked) => {
      setMyParked(at);
      setArrived(true);
      try {
        setMe(await api.park(at.x, at.y, at.a));
        tips.done('drive');
      } catch (e) {
        sayError(e);
      }
    },
    [setMe, sayError, tips]
  );

  // Parking: only in a free bay (or, on a bike, the rack), straightened up, and
  // then you get out beside it.
  const parkHere = () => {
    if (!myModel || !spot) return;
    const others = solid.filter((v) => !v.mine).map((v) => ({ model: v.model, at: v.at }));
    const spots = [
      besideVehicle(myModel, spot),
      besideVehicle(myModel, { ...spot, a: spot.a + Math.PI }),
      { x: spot.x, y: spot.y + shapeOf(myModel).h / 2 + 12 },
    ];
    const standAt =
      spots.find((p) => !blockedOnFoot(p, [...others, { model: myModel, at: spot }], onBreak)) ??
      spots[0];
    setDriving(false);
    setMyParked(spot);
    walker.place(standAt, 0);
    playSound('car_door');
    park(spot);
  };

  const getIn = () => {
    if (!mine) return;
    setLooking(null);
    setDriving(true);
    walker.place(mine.at, mine.at.a);
    playSound('car_door');
  };

  // You park before you go in.
  const walkIn = () => {
    if (driving && myModel)
      return say(
        isBike(myModel)
          ? 'Park your bike in the rack first, by the office.'
          : 'Park first: drive into a free bay and stop.'
      );
    go('/office');
  };

  const goHome = async () => {
    setLeaving(true);
    try {
      setMe(await api.goHome());
    } catch (e) {
      sayError(e);
    } finally {
      setLeaving(false);
    }
  };

  // Logging out is going home: you've left, break or no break.
  const logOut = async () => {
    setLeaving(true);
    try {
      if (atWork) await api.goHome();
      await cancelSessionEnd();
      // No notifications for you on this device once you've gone.
      await turnOff().catch(() => {});
      await supabase.auth.signOut();
    } catch (e) {
      sayError(e);
      setLeaving(false);
    }
  };

  // --- smoking -------------------------------------------------------------

  const smoking = useLit(me.activity === 'smoking' ? me.activity_until : null);
  useEffect(() => {
    setSmoking(smoking);
    return () => setSmoking(false);
  }, [smoking]);
  const cigarettes = me.inventory.cigarette ?? 0;
  const smoke = async () => {
    try {
      await api.smoke();
      playSound('lighter');
      await refresh();
    } catch (e) {
      sayError(e);
    }
  };

  // --- claims --------------------------------------------------------------

  const claim = async (crash: Crash, yes: boolean) => {
    try {
      setMe(await api.claimCrash(crash.id, yes));
      if (yes) playSound('coin');
    } catch (e) {
      sayError(e);
    }
  };

  // --- the scene -----------------------------------------------------------

  const art = (
    <Pan by={walker.pan} width={WORLD.w}>
      <Backdrop onBreak={onBreak} />

      {parked.map((v) => (
        <Faint key={v.username} on={!!v.via}>
          <VehicleAt model={v.model} at={v.at} health={v.health} />
        </Faint>
      ))}
      {friendsDriving.map((v) => (
        <FollowVehicle key={v.username} whereabouts={whereabouts} who={v.username} home={v.at}>
          <Faint on={!!v.via}>
            <VehicleArt model={v.model} health={v.health} />
          </Faint>
        </FollowVehicle>
      ))}
      {friendsDriving
        .filter((v) => isBike(v.model))
        .map((v) => (
          <Follow
            key={`rider-${v.username}`}
            whereabouts={whereabouts}
            who={v.username}
            home={v.at}
          >
            <Faint on={!!v.via}>
              <Person username={v.username} x={0} y={RIDER_Y} />
            </Faint>
          </Follow>
        ))}
      {around.map((f) => (
        <Follow key={f.username} whereabouts={whereabouts} who={f.username} home={DOOR}>
          <Person
            username={f.username}
            x={0}
            y={0}
            activity={me.under_18 ? null : f.activity}
            smokingUntil={f.activity_until}
          />
        </Follow>
      ))}
      {strangersAround.map((s) => (
        <Follow key={s.username} whereabouts={whereabouts} who={s.username} home={DOOR}>
          <Faint>
            <Person username={s.username} x={0} y={0} />
          </Faint>
        </Follow>
      ))}
      {driving && myModel ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pivot,
            {
              transform: [
                ...walker.pos.getTranslateTransform(),
                {
                  rotate: walker.turn.interpolate({
                    inputRange: [0, 360],
                    outputRange: ['0deg', '360deg'],
                  }),
                },
              ],
            },
          ]}
        >
          <VehicleArt model={myModel} health={me.vehicle_health} />
        </Animated.View>
      ) : null}
      {driving && myModel && isBike(myModel) && (
        <Animated.View
          pointerEvents="none"
          style={[walkabout.figure, { transform: walker.pos.getTranslateTransform() }]}
        >
          <Person username={me.username} x={0} y={RIDER_Y} />
        </Animated.View>
      )}
      {!driving && (
        <Animated.View
          pointerEvents="none"
          style={[walkabout.figure, { transform: walker.pos.getTranslateTransform() }]}
        >
          <Person
            username={me.username}
            x={0}
            y={0}
            activity={me.activity}
            smokingUntil={me.activity_until}
          />
        </Animated.View>
      )}
    </Pan>
  );

  const glow = (
    <Pan by={walker.pan} width={WORLD.w}>
      <BackdropGlow />
      {parked
        .filter((v) => !isBike(v.model))
        .map((v) => (
          <Pivot key={v.username} at={v.at}>
            <CarLights model={v.model} x={0} y={shapeOf(v.model).h / 2} />
          </Pivot>
        ))}
    </Pan>
  );

  const vehicleLabel = (v: Vehicle) =>
    v.mine
      ? `Your ${itemInfo(v.model).name.toLowerCase()}`
      : v.via
        ? `${v.name}'s ${kindOf(v.model)}`
        : `${v.name}'s ${itemInfo(v.model).name.toLowerCase()}`;

  const overlay = (
    <Pan by={walker.pan} width={WORLD.w}>
      <Hotspot x={140} y={80} w={80} h={74} label="Walk into the office" onPress={walkIn} />
      <Tag x={180} y={156} text="Office" dim />
      <Hotspot
        x={234}
        y={90}
        w={62}
        h={44}
        label="Friends board"
        onPress={() => go('/friends', null)}
      />
      <Hotspot
        x={GATE.x - 26}
        y={154}
        w={52}
        h={66}
        label="Garden gate"
        disabled={!onBreak}
        onPress={() => go('/garden')}
      />
      {onBreak && <Tag x={GATE.x} y={204} text="Garden" dim />}
      {parked.map((v) => {
        const s = shapeOf(v.model);
        const size = Math.max(s.w, s.h);
        return (
          <View key={v.username} pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            <Tag x={v.at.x} y={v.at.y + s.h / 2 - 2} text={v.mine ? 'You' : v.name} dim={!!v.via} />
            <Hotspot
              x={v.at.x - size / 2}
              y={v.at.y - size / 2}
              w={size}
              h={size}
              label={vehicleLabel(v)}
              onPress={() => setLooking(v.username)}
            />
          </View>
        );
      })}
      {around.map((f) => (
        <Follow key={f.username} whereabouts={whereabouts} who={f.username} home={DOOR}>
          <Label name={f.display_name} bubble={chat.bubbles[f.username]} />
        </Follow>
      ))}
      {strangersAround.map((s) => (
        <Follow key={s.username} whereabouts={whereabouts} who={s.username} home={DOOR}>
          <Tag x={0} y={5} text={nameFor(s, revealed)} dim />
        </Follow>
      ))}
      <Animated.View
        pointerEvents="none"
        style={[walkabout.figure, { transform: walker.pos.getTranslateTransform() }]}
      >
        <Label name="You" bubble={chat.bubbles[me.username]} />
      </Animated.View>
    </Pan>
  );

  // What you can do where you are (done by `run`, as you press it).
  type Act = 'park' | 'go in' | 'board' | 'gate' | 'get in' | 'look';
  const actions: { title: string; label?: string; act: Act; quiet?: boolean }[] = [];
  const nearVehicle =
    near?.kind === 'vehicle' ? parked.find((p) => p.username === near.username) : undefined;
  const bike = !!myModel && isBike(myModel);
  if (driving) {
    if (spot && stopped) actions.push({ title: 'Park here', act: 'park' });
  } else if (near?.kind === 'door') {
    actions.push({ title: 'Go in', act: 'go in' });
  } else if (near?.kind === 'board') {
    actions.push({ title: 'Read the board', act: 'board' });
  } else if (near?.kind === 'gate') {
    actions.push({ title: 'Through the gate', act: 'gate' });
  } else if (nearVehicle?.mine) {
    if (canDrive && !studying) actions.push({ title: bike ? 'Get on' : 'Get in', act: 'get in' });
  } else if (nearVehicle) {
    actions.push({ title: vehicleLabel(nearVehicle), quiet: true, act: 'look' });
  }
  const run = (act: Act) => {
    if (act === 'park') parkHere();
    else if (act === 'go in') walkIn();
    else if (act === 'board') go('/friends', null);
    else if (act === 'gate') go('/garden');
    else if (act === 'get in') getIn();
    else if (nearVehicle) setLooking(nearVehicle.username);
  };

  const looked = looking ? vehicles.find((v) => v.username === looking) : undefined;
  const tip = homeScreenTip ? null : driving && !tips.has('drive') ? (
    <Tip id="drive">
      {bike
        ? "Ride into the bike rack by the office, stop, and park. Mind other people's cars: a bump costs you if they claim."
        : "Drive into a free bay, stop, and park. Mind other people's cars: a bump costs you if they claim."}
    </Tip>
  ) : me.sessions_done === 0 ? (
    <Tip id="welcome">
      Welcome to Focus Together. Study in the office to earn chips and a break, then spend the break
      in the garden with your friends. Walk in to start.
    </Tip>
  ) : me.sessions_studied > 0 && !tips.has('invite') ? (
    <Tip id="invite">{INVITE_TIP}</Tip>
  ) : !me.email ? (
    <Tip id="email" action={{ title: 'Add it', onPress: () => go('/friends', null) }}>
      Add your email on the Friends board, for news of Focus Together. Only you can see it.
    </Tip>
  ) : null;

  return (
    <Scene
      conditions={conditions}
      ground={C.ground}
      outdoor
      art={art}
      glow={glow}
      overlay={overlay}
      onStage={onStage}
      reserve={{ top: 56, bottom: 220 }}
    >
      <SceneHeader
        place="Car park"
        chips={me.chips}
        detail={<HeaderDetail>{conditions.label}</HeaderDetail>}
      />
      <Panel>
        {homeScreenTip ? <HomeScreenTip /> : tip}
        <Greeting me={me} friendsIn={friendNames.length} driving={driving} />
        <CrashNotes me={me} onClaim={claim} />
        {around.length > 0 && !driving && <ChatBar onSay={chat.say} />}
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
                    onPress={() => run(a.act)}
                  />
                ))
              ) : (
                <Muted style={styles.hint} numberOfLines={2}>
                  {driving
                    ? bike
                      ? spot
                        ? 'Stop to park.'
                        : 'Ride into the bike rack, by the office, to park.'
                      : spot
                        ? 'Stop to park.'
                        : 'Drive into a free bay, straight on, to park.'
                    : atWork
                      ? 'Walk about, or tap a car to see how it is.'
                      : 'Walk up to the office door to go in.'}
                </Muted>
              )}
            </View>
            <View style={styles.row}>
              {!me.under_18 && (
                <Button
                  title={smoking ? 'Smoking' : 'Smoke'}
                  accessibilityLabel={`Smoke a cigarette (${cigarettes} left)`}
                  variant="quiet"
                  small
                  style={styles.grow}
                  disabled={smoking || cigarettes === 0 || driving || !atWork}
                  onPress={smoke}
                />
              )}
              {mine && (
                <Button
                  title={`Your ${kindOf(mine.model)}`}
                  accessibilityLabel={vehicleLabel(mine)}
                  variant="quiet"
                  small
                  style={styles.grow}
                  onPress={() => setLooking(me.username)}
                />
              )}
            </View>
          </View>
          {/* On the right, under your thumb (on a computer, the keys to press). */}
          <Steering size={88} onChange={walker.steer} driving={driving} />
        </View>
        <View style={styles.row}>
          <Button title="Walk in" small onPress={walkIn} disabled={leaving} style={styles.flex} />
          <Button
            title="Friends"
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
          <Button
            title="Log out"
            variant="ghost"
            small
            onPress={logOut}
            disabled={leaving}
            style={styles.flex}
          />
        </View>
      </Panel>
      {looked &&
        (looked.via ? (
          <FriendOfFriendSheet
            person={{
              username: looked.username,
              display_name:
                friendsOfFriends.find((f) => f.username === looked.username)?.display_name ??
                looked.name,
              via: looked.via,
            }}
            onClose={() => setLooking(null)}
          />
        ) : (
          <VehicleSheet
            vehicle={looked}
            me={me}
            near={near?.kind === 'vehicle' && near.username === looked.username}
            canDrive={canDrive && !studying && !driving}
            onGetIn={getIn}
            onShed={() => go('/shop?from=index', null)}
            onClose={() => setLooking(null)}
          />
        ))}
      {notice && <Toast key={notice.id} text={notice.text} onDone={clearNotice} />}
      {rift === '1' && (
        <Toast key="rift" text={RIFT_NOTE} onDone={() => router.setParams({ rift: undefined })} />
      )}
    </Scene>
  );
}

function Greeting({ me, friendsIn, driving }: { me: Me; friendsIn: number; driving: boolean }) {
  const tone = useTone();
  if (me.status === 'on_break' && me.break_ends_at) {
    return (
      <View style={{ gap: 2 }}>
        <Body>
          {"You're on a break: "}
          <Countdown
            until={me.break_ends_at}
            minutes
            style={{ color: tone.text, fontWeight: '600' }}
          />
          {" left. The garden's through the gate."}
        </Body>
        <RipeNote ripe={me.ripe} />
        <PostNote letters={me.letters} />
        <RequestNote requests={me.friend_requests} />
      </View>
    );
  }
  const who =
    friendsIn === 0
      ? 'Nobody else is in yet.'
      : friendsIn === 1
        ? 'One friend is in.'
        : `${friendsIn} friends are in.`;
  const vehicle = me.vehicle ? itemInfo(me.vehicle).name.toLowerCase() : null;
  return (
    <View style={{ gap: 2 }}>
      <Body>{who}</Body>
      <Muted>
        {!vehicle
          ? 'You came on foot. The garden shed sells bikes.'
          : me.vehicle_health === 0
            ? `Your ${vehicle} is a wreck, so you came on foot. The shed can repair it.`
            : driving && me.status === 'absent'
              ? `You came by ${vehicle}. Park it to go in.`
              : `You came by ${vehicle}.`}
      </Muted>
      <RipeNote ripe={me.ripe} />
      <PostNote letters={me.letters} />
      <RequestNote requests={me.friend_requests} />
    </View>
  );
}

/**
 * Crashes: into your vehicle, to claim damages for or let go; and ones you
 * caused that have been settled lately.
 */
function CrashNotes({ me, onClaim }: { me: Me; onClaim: (c: Crash, yes: boolean) => void }) {
  const open = me.crashes.find((c) => c.owner === me.username && c.status === 'open');
  const since = Date.parse(me.server_now) - 12 * 3600_000;
  const recent = me.crashes.filter((c) => c.driver === me.username && Date.parse(c.at) > since);
  if (!open && recent.length === 0) return null;
  const name = (slug: string) => itemInfo(slug).name.toLowerCase();
  return (
    <View style={{ gap: 6 }}>
      {open && (
        <>
          <Body>
            {`${open.driver_name} drove into your ${name(open.vehicle)}: ${open.damage} damage, which costs ${open.cost} chips to put right.`}
          </Body>
          <View style={styles.row}>
            <Button
              title={`Claim from ${open.driver_name}`}
              small
              style={styles.flex}
              onPress={() => onClaim(open, true)}
            />
            <Button
              title="Let it go"
              small
              variant="quiet"
              style={styles.flex}
              onPress={() => onClaim(open, false)}
            />
          </View>
        </>
      )}
      {recent.slice(0, 2).map((c) => (
        <Muted key={c.id}>
          {c.status === 'open'
            ? `You drove into ${c.owner_name}'s ${name(c.vehicle)}. They can claim damages from you.`
            : c.status === 'waived'
              ? `${c.owner_name} let the bump to their ${name(c.vehicle)} go.`
              : c.paid_by === 'insurer'
                ? `${c.owner_name} claimed for their ${name(c.vehicle)}, and your insurance paid.`
                : `${c.owner_name} claimed for their ${name(c.vehicle)}: you paid ${c.paid} chips.`}
        </Muted>
      ))}
    </View>
  );
}

/** A vehicle up close: whose it is, and its health out of 100. Yours: insurance and repairs. */
function VehicleSheet({
  vehicle: v,
  me,
  near,
  canDrive,
  onGetIn,
  onShed,
  onClose,
}: {
  vehicle: Vehicle;
  me: Me;
  near: boolean;
  canDrive: boolean;
  onGetIn: () => void;
  onShed: () => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const model = itemInfo(v.model).name;
  const health = Math.max(0, Math.min(100, v.health));
  const shade = health > 60 ? tone.accent : health > 25 ? '#c9a24a' : tone.danger;
  return (
    <Sheet
      title={v.mine ? `Your ${model.toLowerCase()}` : `${v.name}'s ${model.toLowerCase()}`}
      onClose={onClose}
    >
      <Body>{`Health ${health} / 100${health === 0 ? ': a wreck' : ''}`}</Body>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={`Health ${health} out of 100`}
        style={[styles.bar, { backgroundColor: tone.raised, borderColor: tone.line }]}
      >
        <View style={[styles.fill, { width: `${health}%`, backgroundColor: shade }]} />
      </View>
      {v.mine ? (
        <>
          <Muted>
            {me.insured_until
              ? `Insured until ${new Date(me.insured_until).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: if you drive into someone and they claim, the insurance pays.`
              : 'Not insured: if you drive into someone and they claim, you pay for the damage. The shed sells insurance.'}
          </Muted>
          {health < 100 && <Muted>The shed can put it right, for chips.</Muted>}
          <View style={styles.row}>
            {near && canDrive && (
              <Button
                title={isBike(v.model) ? 'Get on' : 'Get in'}
                small
                style={styles.flex}
                onPress={onGetIn}
              />
            )}
            <Button
              title="To the shed"
              small
              variant="quiet"
              style={styles.flex}
              onPress={onShed}
            />
          </View>
        </>
      ) : (
        <Muted>
          {health === 100
            ? 'Not a scratch on it.'
            : 'Someone has bumped into it. Its owner can claim for it.'}
        </Muted>
      )}
    </Sheet>
  );
}

/**
 * The office, the pavement, the rack, the hedge and the bays: everything that
 * doesn't move. Drawn once, and not again each time something else changes.
 */
const Backdrop = memo(function Backdrop({ onBreak }: { onBreak: boolean }) {
  return (
    <>
      {/* The office: flat roof, then the front wall with its windows and door. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={430} c={C.roof} />
      <Box x={BLEED.x} y={24} w={BLEED.w} h={6} c="#6c6058" />
      <Box x={BLEED.x} y={30} w={BLEED.w} h={WALL_Y - 30} c={C.wall} />
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
      {/* the Friends board */}
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
      <Box x={BLEED.x} y={WALL_Y} w={BLEED.w} h={80} c={C.pavement} />
      <Box x={BLEED.x} y={232} w={BLEED.w} h={3} c="#8f8a82" />
      <Box x={RACK.x} y={RACK.y + 8} w={RACK.w} h={3} c="#8b9096" r={1} />
      {RACK_SLOTS.map((s) => (
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
      <Box x={HEDGE_X} y={WALL_Y} w={2100} h={80} c={C.hedge} />
      {[300, 324, 348, 372].map((x) => (
        <Dot key={x} x={x + 10} y={226} d={28} h={14} c="#557352" />
      ))}
      <Box x={GATE.x - 18} y={160} w={36} h={56} c={onBreak ? '#b59a72' : '#9c8466'} r={2} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={GATE.x - 14 + i * 8} y={164} w={4} h={48} c="#8a7154" />
      ))}

      {/* Two rows of six bays, with an aisle between. */}
      <Bays />
      {[-150, -280, 520, 650].map((x, i) => (
        <Tree key={x} x={x} y={300 + (i % 2) * 210} />
      ))}
      {LAMPS.map((l) => (
        <LampPost key={l.x} x={l.x} y={l.y} />
      ))}
    </>
  );
});

/** The lit windows, the door and the lamps, after dark. */
const BackdropGlow = memo(function BackdropGlow() {
  return (
    <>
      {WINDOW_XS.map((x) => (
        <Box key={x} x={x} y={42} w={30} h={30} c={C.lit} r={2} o={0.85} />
      ))}
      {WINDOW_XS.filter((_, i) => i % 3 !== 1).map((x) => (
        <Box key={`b${x}`} x={x} y={100} w={30} h={30} c={C.lit} r={2} o={0.85} />
      ))}
      <Box x={148} y={88} w={64} h={64} c="#f6e2b4" o={0.8} />
      <Glow x={180} y={168} w={170} h={54} c="#f6dca0" o={0.5} />
      {LAMPS.map((p) => (
        <Glow key={p.x} x={p.x} y={p.y - 6} w={150} h={64} c="#ffe2a0" o={0.45} />
      ))}
    </>
  );
});

/** Two rows of bays: each a back line, with a line down either side. */
function Bays() {
  return (
    <>
      {ROW_TOPS.map((y) => (
        <Box key={y} x={BAYS_X} y={y} w={BAYS_PER_ROW * BAY_W} h={2} c={C.line} o={0.8} />
      ))}
      {ROW_TOPS.flatMap((y) =>
        Array.from({ length: BAYS_PER_ROW + 1 }, (_, i) => (
          <Box
            key={`${y}-${i}`}
            x={BAYS_X - 1 + i * BAY_W}
            y={y + 2}
            w={2}
            h={BAY_H}
            c={C.line}
            o={0.8}
          />
        ))
      )}
    </>
  );
}

/** Draws its children with (0, 0) at `at`, turned to face `at.a`. */
function Pivot({ at, children }: { at: Parked; children: ReactNode }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.pivot,
        { transform: [{ translateX: at.x }, { translateY: at.y }, { rotate: `${at.a}rad` }] },
      ]}
    >
      {children}
    </View>
  );
}

/** A vehicle centred on (0, 0), nose up. */
function VehicleArt({ model, health }: { model: string; health: number }) {
  const s = shapeOf(model);
  return model === 'bike' ? (
    <Bike x={0} y={s.h / 2} health={health} />
  ) : (
    <Car model={model} x={0} y={s.h / 2} health={health} />
  );
}

function VehicleAt({ model, at, health }: { model: string; at: Parked; health: number }) {
  return (
    <Pivot at={at}>
      <VehicleArt model={model} health={health} />
    </Pivot>
  );
}

/** A friend's vehicle as they drive it about, easing between the positions they send. */
function FollowVehicle({
  whereabouts,
  who,
  home,
  children,
}: {
  whereabouts: Whereabouts;
  who: string;
  home: Parked;
  children: ReactNode;
}) {
  const [at] = useState(() => new Animated.ValueXY(whereabouts.get(who) ?? home));
  const [turn] = useState(() => new Animated.Value((home.a * 180) / Math.PI));
  useEffect(
    () =>
      whereabouts.watch(who, (to) => {
        Animated.timing(at, {
          toValue: { x: to.x, y: to.y },
          duration: 260,
          useNativeDriver: false,
        }).start();
        const a = (to as Partial<Parked>).a;
        if (a !== undefined) turn.setValue((a * 180) / Math.PI);
      }),
    [whereabouts, who, at, turn]
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pivot,
        {
          transform: [
            ...at.getTranslateTransform(),
            { rotate: turn.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Letters waiting in the garden's post box. */
function PostNote({ letters }: { letters: number }) {
  if (!letters) return null;
  return (
    <Muted>
      {letters === 1
        ? "There's a letter for you in the garden's post box."
        : `There are ${letters} letters for you in the garden's post box.`}
    </Muted>
  );
}

/** Players waiting for you to say whether you'll be friends. */
function RequestNote({ requests }: { requests: number }) {
  if (!requests) return null;
  return (
    <Muted>
      {requests === 1
        ? 'Someone would like to be friends. Answer on the Friends board.'
        : `${requests} people would like to be friends. Answer on the Friends board.`}
    </Muted>
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
  /** A zero-size anchor: things drawn round its (0, 0) turn about that point. */
  pivot: { position: 'absolute', left: 0, top: 0, width: 0, height: 0, overflow: 'visible' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  controls: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  side: { flex: 1, gap: 8 },
  nearby: { flexDirection: 'row', gap: 6, height: 38, alignItems: 'center' },
  hint: { flex: 1, fontSize: 12, lineHeight: 16 },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  /** Side by side, each as wide as its words, sharing what's left. */
  fit: { flexGrow: 1, flexShrink: 1, flexBasis: 'auto' },
  bar: { height: 10, borderRadius: 5, borderWidth: 1, overflow: 'hidden' },
  fill: { height: '100%' },
});
