import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated } from 'react-native';

import { STAGE } from '@/art/Scene';
import { blocked, type Point, type Rect, WORLD } from './gardenMap';

/** Walking pace, in stage units a second; a little slower up and down the garden. */
const SPEED = { x: 110, y: 88 };
/** Distance between footsteps. */
const STRIDE = 26;

export type Direction = { x: number; y: number };

type Options = {
  start: Point;
  obstacles: Rect[];
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

function follow(cam: number, x: number, viewWidth: number) {
  if (viewWidth >= WORLD.w) return WORLD.w / 2;
  const slack = viewWidth * (0.5 - EDGE);
  const target = Math.min(Math.max(cam, x - slack), x + slack);
  return Math.min(WORLD.w - viewWidth / 2, Math.max(viewWidth / 2, target));
}

/**
 * Walks you round the garden: a thumbstick (or the arrow keys) steers, the
 * obstacles stop you, and the camera follows lazily. Positions live in
 * Animated values so walking never re-renders the scene.
 */
export function useWalker({
  start,
  obstacles,
  viewWidth,
  reduceMotion,
  paused,
  onStep,
  onMove,
}: Options) {
  const [pos] = useState(() => new Animated.ValueXY(start));
  /** The garden's offset on the stage: the camera, inverted. */
  const [pan] = useState(() => new Animated.Value(STAGE.width / 2 - start.x));

  const here = useRef({ ...start });
  const cam = useRef(start.x);
  const stick = useRef<Direction>({ x: 0, y: 0 });
  const keys = useRef<Direction>({ x: 0, y: 0 });
  const walked = useRef(0);
  const frame = useRef<number | null>(null);
  const last = useRef(0);
  const opts = useRef({ obstacles, viewWidth, reduceMotion, paused, onStep, onMove });
  useEffect(() => {
    opts.current = { obstacles, viewWidth, reduceMotion, paused, onStep, onMove };
  });

  const tick = useCallback(
    function tick(now: number) {
      const { obstacles, viewWidth, reduceMotion, paused, onStep, onMove } = opts.current;
      const dt = last.current ? Math.min(0.05, (now - last.current) / 1000) : 1 / 60;
      last.current = now;

      const s = stick.current.x || stick.current.y ? stick.current : keys.current;
      const moving = !paused && (s.x !== 0 || s.y !== 0);
      if (moving) {
        const p = here.current;
        const from = { ...p };
        const nx = { x: p.x + s.x * SPEED.x * dt, y: p.y };
        if (!blocked(nx, obstacles)) p.x = nx.x;
        const ny = { x: p.x, y: p.y + s.y * SPEED.y * dt };
        if (!blocked(ny, obstacles)) p.y = ny.y;
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

      const target = follow(cam.current, here.current.x, viewWidth);
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
    [pos, pan]
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

  /** Puts you somewhere at once (sitting down on a bench). */
  const place = useCallback(
    (at: Point) => {
      here.current = { ...at };
      pos.setValue(at);
      wake();
    },
    [pos, wake]
  );

  return { pos, pan, steer, where, place };
}
