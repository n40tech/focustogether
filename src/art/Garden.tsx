import type { Plot } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { palette } from '@/lib/theme';
import { Box, Dot, Shadow } from './primitives';
import { BLEED } from './Scene';

const G = palette.garden;

export const BED = { w: 56, h: 40, gap: 6 };
export const PLOT = { w: BED.w * 2 + BED.gap, h: BED.h * 2 + BED.gap };

/** Top-left corner of bed 0–3 in a plot whose top-left is (x, y). */
export const bedOrigin = (x: number, y: number, bed: number) => ({
  x: x + (bed % 2) * (BED.w + BED.gap),
  y: y + Math.floor(bed / 2) * (BED.h + BED.gap),
});

/** A raised bed seen from above and in front, with whatever grows in it. */
export function RaisedBed({
  x,
  y,
  plot,
  wet,
}: {
  x: number;
  y: number;
  plot?: Plot;
  wet: boolean;
}) {
  return (
    <>
      <Box x={x + 3} y={y + 4} w={BED.w} h={BED.h} c="#16181b" r={3} o={0.12} />
      <Box x={x} y={y} w={BED.w} h={BED.h - 6} c={G.bed} r={3} />
      <Box
        x={x + 4}
        y={y + 4}
        w={BED.w - 8}
        h={BED.h - 14}
        c={wet || plot?.watered ? G.soilWet : G.soil}
        r={2}
      />
      <Box x={x} y={y + BED.h - 6} w={BED.w} h={6} c="#85633f" r={2} />
      {plot && (
        <Crop
          crop={plot.crop}
          progress={plot.growth_min / plot.grow_min}
          ripe={plot.ripe}
          x={x + BED.w / 2}
          y={y + 18}
        />
      )}
    </>
  );
}

const LEAF = '#6f9a5c';
const LEAF_DARK = '#5b844b';

/** A crop at its growth stage, centred on (x, y). */
export function Crop({
  crop,
  progress,
  ripe,
  x,
  y,
}: {
  crop: string;
  progress: number;
  ripe: boolean;
  x: number;
  y: number;
}) {
  const spots: [number, number][] = [
    [-12, -3],
    [0, 3],
    [12, -3],
  ];
  const fruit = itemInfo(crop).colour;

  if (progress <= 0) {
    return (
      <>
        {spots.map(([dx, dy]) => (
          <Dot key={dx} x={x + dx} y={y + dy} d={2.5} c="#d8c9a6" />
        ))}
      </>
    );
  }
  if (progress < 0.34) {
    return (
      <>
        {spots.map(([dx, dy]) => (
          <Sprout key={dx} x={x + dx} y={y + dy} size={4} />
        ))}
      </>
    );
  }
  if (progress < 0.67) {
    return (
      <>
        {spots.map(([dx, dy]) => (
          <Sprout key={dx} x={x + dx} y={y + dy} size={7} />
        ))}
      </>
    );
  }

  // Mature, then with fruit once ripe.
  switch (crop) {
    case 'sunflower':
      return (
        <>
          <Box x={x - 1.5} y={y - 22} w={3} h={24} c={LEAF_DARK} />
          <Dot x={x - 6} y={y - 6} d={9} h={5} c={LEAF} />
          <Dot x={x + 6} y={y - 12} d={9} h={5} c={LEAF} />
          <Dot x={x} y={y - 26} d={ripe ? 20 : 12} c={ripe ? fruit : LEAF} />
          {ripe && <Dot x={x} y={y - 26} d={8} c="#6b4a2f" />}
        </>
      );
    case 'pumpkin':
      return (
        <>
          <Box x={x - 20} y={y - 1} w={40} h={2.5} c={LEAF_DARK} r={1} />
          <Dot x={x - 15} y={y - 4} d={11} h={8} c={LEAF} />
          <Dot x={x + 15} y={y + 1} d={11} h={8} c={LEAF} />
          <Dot x={x} y={y} d={ripe ? 22 : 10} h={ripe ? 16 : 8} c={ripe ? fruit : '#9fb76a'} />
          {ripe && <Box x={x - 1} y={y - 11} w={2.5} h={5} c="#6b5a3a" />}
        </>
      );
    case 'carrot':
    case 'radish':
      return (
        <>
          {spots.map(([dx, dy]) => (
            <Leaves key={dx} x={x + dx} y={y + dy} size={9} feathery={crop === 'carrot'} />
          ))}
          {ripe &&
            spots.map(([dx, dy]) => (
              <Dot key={`f${dx}`} x={x + dx} y={y + dy + 4} d={6} h={4} c={fruit} />
            ))}
        </>
      );
    default:
      // tomato, strawberry and anything new: a bushy plant with fruit.
      return (
        <>
          <Dot x={x - 8} y={y} d={16} h={13} c={LEAF} />
          <Dot x={x + 8} y={y - 2} d={16} h={13} c={LEAF_DARK} />
          <Dot x={x} y={y - 6} d={14} h={11} c={LEAF} />
          {ripe &&
            [
              [-9, 1],
              [6, -6],
              [9, 3],
              [-2, -2],
            ].map(([dx, dy]) => (
              <Dot
                key={`${dx}${dy}`}
                x={x + dx}
                y={y + dy}
                d={crop === 'strawberry' ? 4 : 5.5}
                c={fruit}
              />
            ))}
        </>
      );
  }
}

function Sprout({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <>
      <Dot x={x - size * 0.35} y={y} d={size} h={size * 0.6} c={LEAF} />
      <Dot x={x + size * 0.35} y={y - size * 0.15} d={size} h={size * 0.6} c={LEAF_DARK} />
    </>
  );
}

function Leaves({
  x,
  y,
  size,
  feathery,
}: {
  x: number;
  y: number;
  size: number;
  feathery: boolean;
}) {
  return feathery ? (
    <>
      {[-3, 0, 3].map((dx) => (
        <Box key={dx} x={x + dx - 1} y={y - size} w={2} h={size} c={LEAF} r={1} />
      ))}
    </>
  ) : (
    <Sprout x={x} y={y - 2} size={size} />
  );
}

/** A 2 × 2 plot of raised beds; `beds` lists what's planted. */
export function AllotmentPlot({
  x,
  y,
  plots,
  wet,
}: {
  x: number;
  y: number;
  plots: Plot[];
  wet: boolean;
}) {
  return (
    <>
      {[0, 1, 2, 3].map((bed) => {
        const o = bedOrigin(x, y, bed);
        return (
          <RaisedBed key={bed} x={o.x} y={o.y} plot={plots.find((p) => p.bed === bed)} wet={wet} />
        );
      })}
    </>
  );
}

export function Shed({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 42} y={y + 84} w={100} o={0.12} />
      <Box x={x} y={y} w={84} h={36} c={G.shedRoof} r={3} />
      {[0, 1, 2, 3].map((i) => (
        <Box key={i} x={x} y={y + 6 + i * 8} w={84} h={1.5} c="#5a4638" />
      ))}
      <Box x={x + 2} y={y + 36} w={80} h={46} c={G.shed} />
      <Box x={x + 30} y={y + 46} w={24} h={36} c="#6f5847" r={2} />
      <Dot x={x + 50} y={y + 64} d={3} c="#d9c9a0" />
      <Box x={x + 8} y={y + 46} w={16} h={14} c="#c8d3d6" r={1} />
    </>
  );
}

export function WaterButt({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x} y={y} w={30} />
      <Box x={x - 11} y={y - 26} w={22} h={26} c={G.butt} r={5} />
      <Dot x={x} y={y - 26} d={22} h={8} c="#6c7882" />
    </>
  );
}

export function Bench({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 30} y={y + 16} w={70} o={0.1} />
      <Box x={x} y={y} w={60} h={5} c={G.bench} r={2} />
      <Box x={x} y={y + 7} w={60} h={5} c={G.bench} r={2} />
      <Box x={x + 4} y={y + 12} w={3} h={6} c="#6e5640" />
      <Box x={x + 53} y={y + 12} w={3} h={6} c="#6e5640" />
    </>
  );
}

/** A hedge running along the back, drawn wide so it continues past the stage. */
export function Hedge({ y, h }: { y: number; h: number }) {
  return (
    <>
      <Box x={BLEED.x} y={y} w={BLEED.w} h={h} c={G.hedge} />
      {Array.from({ length: 128 }, (_, i) => (
        <Dot
          key={i}
          x={-1980 + i * 34}
          y={y + h - 6 - (i % 3) * 5}
          d={30}
          h={16}
          c={i % 2 ? '#6a8a63' : '#557352'}
        />
      ))}
    </>
  );
}
