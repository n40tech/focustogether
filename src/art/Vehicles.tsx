import { itemInfo } from '@/lib/catalog';
import { Box, Dot } from './primitives';

const GLASS = '#3f4d57';
const TYRE = '#26282c';

type Shape = { w: number; h: number; roof: boolean; boxy?: boolean };

const SHAPES: Record<string, Shape> = {
  hatchback: { w: 38, h: 58, roof: true },
  estate: { w: 40, h: 72, roof: true },
  campervan: { w: 44, h: 76, roof: true, boxy: true },
  roadster: { w: 38, h: 66, roof: false },
};

const DENT = '#2b2826';
const SCRATCH = '#d9d4ca';

/**
 * A parked car seen from above and in front, nose towards the top of the
 * screen. `x` is its centre and `y` its rear bumper. Below full `health` it
 * shows it: scratches, then dents, a cracked windscreen and a crumpled
 * bumper, and at the end a bonnet that's sprung open.
 */
export function Car({
  model,
  x,
  y,
  health = 100,
}: {
  model: string;
  x: number;
  y: number;
  health?: number;
}) {
  const s = SHAPES[model] ?? SHAPES.hatchback;
  const colour = itemInfo(model).colour;
  const left = x - s.w / 2;
  const top = y - s.h;
  return (
    <>
      <Box x={left + 4} y={top + 5} w={s.w} h={s.h} c="#16181b" r={s.boxy ? 7 : 12} o={0.2} />
      {[0.2, 0.75].map((k) => (
        <Box key={k} x={left - 3} y={top + s.h * k} w={s.w + 6} h={10} c={TYRE} r={3} />
      ))}
      <Box x={left} y={top} w={s.w} h={s.h} c={colour} r={s.boxy ? 7 : 12} />
      {s.roof ? (
        <>
          {/* windscreen, roof, rear window */}
          <Box x={left + 4} y={top + s.h * 0.22} w={s.w - 8} h={s.h * 0.17} c={GLASS} r={4} />
          <Box
            x={left + 5}
            y={top + s.h * 0.39}
            w={s.w - 10}
            h={s.h * (s.boxy ? 0.45 : 0.32)}
            c={s.boxy ? '#efe8da' : colour}
            r={4}
            style={{ borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }}
          />
          <Box
            x={left + 6}
            y={top + s.h * (s.boxy ? 0.86 : 0.74)}
            w={s.w - 12}
            h={s.h * 0.1}
            c={GLASS}
            r={3}
          />
          {model === 'estate' &&
            [0.12, 0.88].map((k) => (
              <Box
                key={k}
                x={left + s.w * k - 1}
                y={top + s.h * 0.4}
                w={2}
                h={s.h * 0.32}
                c="#8b8f94"
              />
            ))}
        </>
      ) : (
        <>
          {/* open top: windscreen and two seats */}
          <Box x={left + 5} y={top + s.h * 0.38} w={s.w - 10} h={3} c={GLASS} r={1} />
          <Box x={left + 5} y={top + s.h * 0.48} w={s.w / 2 - 7} h={s.h * 0.2} c="#7a5a44" r={4} />
          <Box x={x + 2} y={top + s.h * 0.48} w={s.w / 2 - 7} h={s.h * 0.2} c="#7a5a44" r={4} />
        </>
      )}
      {/* headlights and tail lights */}
      <Dot x={left + 7} y={top + 3} d={6} h={3} c="#f1ecd8" />
      <Dot x={left + s.w - 7} y={top + 3} d={6} h={3} c="#f1ecd8" />
      <Dot x={left + 6} y={y - 2} d={5} h={2.5} c="#b5483e" />
      <Dot x={left + s.w - 6} y={y - 2} d={5} h={2.5} c="#b5483e" />
      <Damage left={left} top={top} w={s.w} h={s.h} health={health} />
    </>
  );
}

/** Wear on a car body `w` by `h` at (left, top), worse as its health falls. */
function Damage({
  left,
  top,
  w,
  h,
  health,
}: {
  left: number;
  top: number;
  w: number;
  h: number;
  health: number;
}) {
  if (health >= 85) return null;
  return (
    <>
      {/* A long scratch down one side. */}
      <Box x={left + w - 5} y={top + h * 0.3} w={1.5} h={h * 0.4} c={SCRATCH} o={0.7} r={1} />
      {health < 60 && (
        <>
          <Dot x={left + 6} y={top + 8} d={11} h={8} c={DENT} o={0.35} />
          <Dot x={left + w - 8} y={top + h - 9} d={10} h={7} c={DENT} o={0.3} />
          <Box x={left + 3} y={top + h * 0.6} w={1.5} h={h * 0.2} c={SCRATCH} o={0.6} r={1} />
        </>
      )}
      {health < 35 && (
        <>
          {/* A cracked windscreen, and a crumpled front bumper. */}
          <Box
            x={left + w * 0.3}
            y={top + h * 0.24}
            w={w * 0.4}
            h={1}
            c={SCRATCH}
            o={0.8}
            style={{ transform: [{ rotate: '24deg' }] }}
          />
          <Box
            x={left + w * 0.35}
            y={top + h * 0.3}
            w={w * 0.3}
            h={1}
            c={SCRATCH}
            o={0.8}
            style={{ transform: [{ rotate: '-30deg' }] }}
          />
          <Box x={left + 2} y={top - 2} w={w * 0.55} h={5} c="#55595e" r={2} />
        </>
      )}
      {health < 15 && (
        <Box
          x={left + 3}
          y={top + 1}
          w={w - 6}
          h={h * 0.2}
          c={DENT}
          o={0.45}
          r={4}
          style={{ transform: [{ rotate: '-6deg' }] }}
        />
      )}
    </>
  );
}

/** Headlight glow, drawn in the glow layer so it shines after dark. */
export function CarLights({ model, x, y }: { model: string; x: number; y: number }) {
  const s = SHAPES[model] ?? SHAPES.hatchback;
  const top = y - s.h;
  return (
    <>
      <Dot x={x - s.w / 2 + 7} y={top + 3} d={7} h={4} c="#fff6d8" />
      <Dot x={x + s.w / 2 - 7} y={top + 3} d={7} h={4} c="#fff6d8" />
    </>
  );
}

/**
 * A bicycle in the rack, seen from above: two narrow tyres in line, a frame
 * and handlebars. `x` is its centre and `y` its back wheel.
 */
export function Bike({
  x,
  y,
  colour = itemInfo('bike').colour,
  health = 100,
}: {
  x: number;
  y: number;
  colour?: string;
  /** Bent: a buckled front wheel below half, and twisted handlebars near the end. */
  health?: number;
}) {
  const buckled = health < 50 ? { transform: [{ rotate: '14deg' }] } : undefined;
  const twisted = health < 20 ? { transform: [{ rotate: '-18deg' }] } : undefined;
  return (
    <>
      <Box x={x - 1} y={y - 38} w={5} h={40} c="#16181b" r={2} o={0.15} />
      <Box x={x - 2} y={y - 12} w={4} h={12} c={TYRE} r={2} />
      <Box x={x - 2} y={y - 40} w={4} h={12} c={TYRE} r={2} style={buckled} />
      <Box x={x - 1.5} y={y - 30} w={3} h={20} c={colour} r={1} />
      <Box x={x - 3} y={y - 16} w={6} h={5} c="#3a3532" r={2} />
      <Box x={x - 8} y={y - 31} w={16} h={2.5} c="#4a4d55" r={1} style={twisted} />
      {health < 85 && <Box x={x + 1} y={y - 27} w={1} h={8} c={SCRATCH} o={0.7} />}
    </>
  );
}
