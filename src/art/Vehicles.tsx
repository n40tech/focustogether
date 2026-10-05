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

/**
 * A parked car seen from above and in front, nose towards the top of the
 * screen. `x` is its centre and `y` its rear bumper.
 */
export function Car({ model, x, y }: { model: string; x: number; y: number }) {
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
}: {
  x: number;
  y: number;
  colour?: string;
}) {
  return (
    <>
      <Box x={x - 1} y={y - 38} w={5} h={40} c="#16181b" r={2} o={0.15} />
      <Box x={x - 2} y={y - 12} w={4} h={12} c={TYRE} r={2} />
      <Box x={x - 2} y={y - 40} w={4} h={12} c={TYRE} r={2} />
      <Box x={x - 1.5} y={y - 30} w={3} h={20} c={colour} r={1} />
      <Box x={x - 3} y={y - 16} w={6} h={5} c="#3a3532" r={2} />
      <Box x={x - 8} y={y - 31} w={16} h={2.5} c="#4a4d55" r={1} />
    </>
  );
}
