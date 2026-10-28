import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

import { STAGE } from '@/art/Scene';
import type { Parked } from '@/lib/api';
import { shapeOf } from './carParkMap';
import { blocked, type Point, type Rect, WORLD } from './gardenMap';

/** Walking pace, in stage units a second; a little slower up and down the garden. */
const SPEED = { x: 110, y: 88 };
/** Distance between footsteps. */
const STRIDE = 26;
/** How fast a vehicle turns at speed (radians a second), and speeds up and slows down. */
const TURN = 2.4;
const ACCELERATE = 130;
const BRAKE = 280;
const COAST = 110;

export type Direction = { x: number; y: number };

/** Driving a vehicle, rather than walking. */
export type Driving = {
  model: string;
  /** What a vehicle posed here would hit: a friend's username, 'wall', or null. */
  collide: (pose: Parked) => string | null;
  /** It hit something at `speed` (stage units a second). */
  onHit: (what: string, speed: number) => void;
};

/** Keeps an angle between -pi and pi. */
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Options = {
  start: Point;
  /** Which way you (or your vehicle) face at the start, in radians: 0 is up the screen. */
  heading?: number;
  /** In the garden: things you can't walk through. */
  obstacles?: Rect[];
  /** Elsewhere: whether you can't stand at a point (instead of `obstacles`). */
  blocks?: (p: Point) => boolean;
  /** How wide the place is, for the camera. */
  worldWidth?: number;
  /** While you're driving: the vehicle, and what to do when it hits something. */
  driving?: Driving | null;
  /** How much of the garden fits across the screen, in stage units. */
  viewWidth: number;
  /** Snap the camera rather than ease it. */
  reduceMotion: boolean;
  /** Stand still whatever the controls say (a sheet's open, or you can't walk here now). */
  paused: boolean;
  /** A footfall, for the sound of it. */
  onStep: (at: Point) => void;
  /** Called (at most once a frame) whenever you move. */
  onMove: (at: Point) => void;
};

/** The camera holds still until you get within this share of the screen's edge. */
const EDGE = 0.32;

function cameraAt(cam: number, x: number, viewWidth: number, worldWidth: number) {
  if (viewWidth >= worldWidth) return worldWidth / 2;
  const slack = viewWidth * (0.5 - EDGE);
  const target = Math.min(Math.max(cam, x - slack), x + slack);
  return Math.min(worldWidth - viewWidth / 2, Math.max(viewWidth / 2, target));
}

/**
 * Walks you round the garden (or the car park): a thumbstick (or the arrow
 * keys) steers, the obstacles stop you, and the camera follows lazily.
 * Positions live in Animated values so walking never re-renders the scene.
 *
 * With `driving`, you're in a vehicle instead. The stick points where to go
 * (the vehicle turns that way as it moves, and backs up if you point behind
 * it); the up and down keys drive forwards and back, and left and right steer.
 */
export function useWalker({
  start,
  heading: startHeading = 0,
  obstacles = [],
  blocks,
  worldWidth = WORLD.w,
  driving = null,
  viewWidth,
  reduceMotion,
  paused,
  onStep,
  onMove,
}: Options) {
  const [pos] = useState(() => new Animated.ValueXY(start));
  /** The place's offset on the stage: the camera, inverted. */
  const [pan] = useState(() => new Animated.Value(STAGE.width / 2 - start.x));
  /** Which way your vehicle faces, in degrees (for a rotate transform). */
  const [turn] = useState(() => new Animated.Value((startHeading * 180) / Math.PI));

  const here = useRef({ ...start });
  const heading = useRef(startHeading);
  /** Stage units a second, forwards (negative when backing up). */
  const speed = useRef(0);
  const cam = useRef(start.x);
  const stick = useRef<Direction>({ x: 0, y: 0 });
  const keys = useRef<Direction>({ x: 0, y: 0 });
  const walked = useRef(0);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const opts = useRef({
    obstacles,
    blocks,
    worldWidth,
    driving,
    viewWidth,
    reduceMotion,
    paused,
    onStep,
    onMove,
  });
  useEffect(() => {
    opts.current = {
      obstacles,
      blocks,
      worldWidth,
      driving,
      viewWidth,
      reduceMotion,
      paused,
      onStep,
      onMove,
    };
  });

  /** One frame of driving; returns whether the vehicle's still moving. */
  const drive = useCallback(
    (car: Driving, dt: number, paused: boolean) => {
      const shape = shapeOf(car.model);
      const st = stick.current;
      const k = keys.current;
      let throttle = 0;
      let dh = 0;
      if (!paused && (st.x || st.y)) {
        // Point where you want to go: turn that way, or back up if it's behind you.
        const push = Math.min(1, Math.hypot(st.x, st.y));
        const diff = wrap(Math.atan2(st.x, -st.y) - heading.current);
        const ahead = Math.abs(diff) <= 2;
        throttle = ahead ? push : -push;
        const can = TURN * dt * Math.min(1, Math.abs(speed.current) / 40);
        dh = clamp(ahead ? diff : wrap(diff - Math.PI), -can, can);
      } else if (!paused && (k.x || k.y)) {
        throttle = -Math.sign(k.y);
        dh = Math.sign(k.x) * TURN * dt * clamp(speed.current / 40, -1, 1);
      }
      const target = throttle >= 0 ? throttle * shape.speed : throttle * shape.reverse;
      const rate =
        throttle === 0
          ? COAST
          : Math.sign(target) !== Math.sign(speed.current)
            ? BRAKE
            : ACCELERATE;
      speed.current += clamp(target - speed.current, -rate * dt, rate * dt);
      if (Math.abs(speed.current) < 0.5 && throttle === 0) speed.current = 0;

      const a = wrap(heading.current + dh);
      const p = here.current;
      const next = {
        x: p.x + Math.sin(a) * speed.current * dt,
        y: p.y - Math.cos(a) * speed.current * dt,
        a,
      };
      const going = speed.current !== 0 || dh !== 0;
      const hit = going ? car.collide(next) : null;
      if (hit) {
        car.onHit(hit, Math.abs(speed.current));
        // Bounce off a little.
        speed.current = -speed.current * 0.25;
      } else if (going) {
        p.x = next.x;
        p.y = next.y;
        heading.current = a;
        pos.setValue({ x: p.x, y: p.y });
        turn.setValue((a * 180) / Math.PI);
        opts.current.onMove({ ...p });
      }
      return speed.current !== 0 || throttle !== 0;
    },
    [pos, turn]
  );

  const tick = useCallback(
    function tick(now: number) {
      const {
        obstacles,
        blocks,
        worldWidth,
        driving,
        viewWidth,
        reduceMotion,
        paused,
        onStep,
        onMove,
      } = opts.current;
      const dt = last.current ? Math.min(0.05, (now - last.current) / 1000) : 1 / 60;
      last.current = now;
      const stuck = (p: Point) => (blocks ? blocks(p) : blocked(p, obstacles));

      const s = stick.current.x || stick.current.y ? stick.current : keys.current;
      const moving = driving ? drive(driving, dt, paused) : !paused && (s.x !== 0 || s.y !== 0);
      if (moving && !driving) {
        const p = here.current;
        const from = { ...p };
        const nx = { x: p.x + s.x * SPEED.x * dt, y: p.y };
        if (!stuck(nx)) p.x = nx.x;
        const ny = { x: p.x, y: p.y + s.y * SPEED.y * dt };
        if (!stuck(ny)) p.y = ny.y;
        const moved = Math.hypot(p.x - from.x, p.y - from.y);
        if (moved > 0) {
          pos.setValue({ x: p.x, y: p.y });
          walked.current += moved;
          if (walked.current >= STRIDE) {
            walked.current = 0;
            onStep({ ...p });
          }
          onMove({ ...p });
        }
      }

      const target = cameraAt(cam.current, here.current.x, viewWidth, worldWidth);
      const gap = target - cam.current;
      cam.current = reduceMotion || Math.abs(gap) < 0.3 ? target : cam.current + gap * 0.1;
      pan.setValue(STAGE.width / 2 - cam.current);

      if (moving || cam.current !== target) {
        frame.current = requestAnimationFrame(tick);
      } else {
        frame.current = null;
        last.current = 0;
        // The next step starts on a fresh foot.
        walked.current = STRIDE * 0.6;
      }
    },
    [pos, pan, drive]
  );

  const wake = useCallback(() => {
    if (frame.current === null) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    []
  );

  // A new screen size can move the camera.
  useEffect(() => {
    wake();
  }, [viewWidth, wake]);

  const steer = useCallback(
    (d: Direction) => {
      stick.current = d;
      wake();
    },
    [wake]
  );

  // Arrow keys and WASD on the web, unless you're typing.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const held = new Set<string>();
    const DIRS: Record<string, Direction> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
      d: { x: 1, y: 0 },
    };
    const update = () => {
      let x = 0;
      let y = 0;
      held.forEach((k) => {
        x += DIRS[k].x;
        y += DIRS[k].y;
      });
      const len = Math.hypot(x, y) || 1;
      keys.current = { x: x / len, y: y / len };
      wake();
    };
    const typing = () => {
      const el = document.activeElement;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    };
    const down = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!DIRS[key] || typing() || e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      held.add(key);
      update();
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (held.delete(key)) update();
    };
    const clear = () => {
      held.clear();
      update();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [wake]);

  /** Where you are right now (read it in callbacks, not while rendering). */
  const where = useCallback(() => ({ ...here.current }), []);

  /** Puts you somewhere at once (sitting down on a bench, getting into a vehicle). */
  const place = useCallback(
    (at: Point, facing?: number) => {
      here.current = { x: at.x, y: at.y };
      pos.setValue({ x: at.x, y: at.y });
      speed.current = 0;
      if (facing !== undefined) {
        heading.current = facing;
        turn.setValue((facing * 180) / Math.PI);
      }
      wake();
    },
    [pos, turn, wake]
  );

  /** Which way you face (radians), and how fast you're driving (stage units a second). */
  const facing = useCallback(() => heading.current, []);
  const driven = useCallback(() => speed.current, []);

  /** True while the stick or the keys are steering you. */
  const steering = useCallback(() => {
    const s = stick.current.x || stick.current.y ? stick.current : keys.current;
    return !opts.current.paused && (s.x !== 0 || s.y !== 0);
  }, []);

  /**
   * Goes where another device of yours says you are: there at once as far as
   * the game's concerned, and drawn walking there over `ms` (or there at once).
   */
  const follow = useCallback(
    (at: Point, ms: number) => {
      here.current = { ...at };
      if (ms > 0 && !opts.current.reduceMotion)
        Animated.timing(pos, {
          toValue: at,
          duration: ms,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      else pos.setValue(at);
      wake();
    },
    [pos, wake]
  );

  return { pos, pan, turn, steer, where, place, steering, follow, facing, driven };
}
