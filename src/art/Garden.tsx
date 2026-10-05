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

/** How a ripe crop is holding up: fresh, going over (its last 12 hours), or withered. */
export type Look = 'fresh' | 'over' | 'withered';

/** Ripe crops start to go over this long before they wither. */
const GOING_OVER_MS = 12 * 60 * 60 * 1000;

export function lookOf(plot: Plot, now: number): Look {
  if (plot.withered) return 'withered';
  if (plot.ripe && plot.withers_at && Date.parse(plot.withers_at) - now < GOING_OVER_MS)
    return 'over';
  return 'fresh';
}

/** Where each of a bed's four plants grows: two at the back, two at the front. */
const SPOTS: [number, number][] = [
  [16, 13],
  [40, 13],
  [16, 26],
  [40, 26],
];

/** A raised bed seen from above and in front, with whatever grows in it. */
export function RaisedBed({
  x,
  y,
  plants,
  wet,
  now,
}: {
  x: number;
  y: number;
  /** What's planted in it: up to four plants, one per spot. */
  plants: Plot[];
  wet: boolean;
  /** Server-corrected time, for crops going over. */
  now: number;
}) {
  const watered = wet || plants.some((p) => p.watered);
  return (
    <>
      <Box x={x + 3} y={y + 4} w={BED.w} h={BED.h} c="#16181b" r={3} o={0.12} />
      <Box x={x} y={y} w={BED.w} h={BED.h - 6} c={G.bed} r={3} />
      <Box
        x={x + 4}
        y={y + 4}
        w={BED.w - 8}
        h={BED.h - 14}
        c={watered ? G.soilWet : G.soil}
        r={2}
      />
      <Box x={x} y={y + BED.h - 6} w={BED.w} h={6} c="#85633f" r={2} />
      {/* A withered plant has dropped a few leaves round it. */}
      {plants
        .filter((p) => p.withered)
        .flatMap((p) => {
          const [sx, sy] = SPOTS[p.spot] ?? SPOTS[0];
          return [
            [-7, -3],
            [6, 1],
            [-2, 4],
          ].map(([dx, dy]) => (
            <Dot
              key={`${p.spot}${dx}`}
              x={x + sx + dx}
              y={y + sy + dy}
              d={4.5}
              h={2.2}
              c="#7a6748"
              o={0.9}
            />
          ));
        })}
      {[...plants]
        .sort((a, b) => a.spot - b.spot)
        .map((p) => {
          const [sx, sy] = SPOTS[p.spot] ?? SPOTS[0];
          return (
            <Plant
              key={p.spot}
              crop={p.crop}
              progress={p.progress}
              ripe={p.ripe || p.withered}
              look={lookOf(p, now)}
              x={x + sx}
              y={y + sy}
            />
          );
        })}
    </>
  );
}

/** Leaf and fruit colours as a crop goes over, then withers. */
const LOOKS: Record<
  Look,
  { leaf: string; dark: string; rot: number; droop: number; size: number }
> = {
  fresh: { leaf: '#6f9a5c', dark: '#5b844b', rot: 0, droop: 0, size: 1 },
  over: { leaf: '#8f9b5a', dark: '#7a874b', rot: 0.25, droop: 1, size: 0.95 },
  withered: { leaf: '#8a7650', dark: '#6f5e42', rot: 0.72, droop: 2.5, size: 0.8 },
};
const ROT = '#5a4632';

/** Blends two #rrggbb colours: t = 0 gives a, 1 gives b. */
function mix(a: string, b: string, t: number) {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** One plant at its growth stage, standing at (x, y): one seed makes one of these. */
export function Plant({
  crop,
  progress,
  ripe,
  look = 'fresh',
  x,
  y,
}: {
  crop: string;
  progress: number;
  ripe: boolean;
  look?: Look;
  x: number;
  y: number;
}) {
  const L = LOOKS[look];
  const LEAF = L.leaf;
  const LEAF_DARK = L.dark;
  const fruit = mix(itemInfo(crop).colour, ROT, L.rot);
  const k = L.size;
  const sag = L.droop;
  const limp = look === 'withered';

  if (progress <= 0) return <Dot x={x} y={y} d={3} c="#d8c9a6" />;
  if (progress < 0.34) return <Sprout x={x} y={y} size={4} leaf={LEAF} dark={LEAF_DARK} />;
  if (progress < 0.67) return <Sprout x={x} y={y} size={6} leaf={LEAF} dark={LEAF_DARK} />;

  // Grown, then with fruit once ripe; going over, then withered, if it's left.
  switch (crop) {
    case 'sunflower': {
      // A tall stalk whose head nods further over as it goes.
      const head = { x: x + sag * 1.5, y: y - 19 + sag * 2.5 };
      return (
        <>
          <Box x={x - 1} y={head.y + 3} w={2} h={y + 1 - head.y - 3} c={LEAF_DARK} />
          <Dot x={x - 4} y={y - 5 + sag} d={7 * k} h={4 * k} c={LEAF} />
          <Dot x={x + 4} y={y - 9 + sag} d={7 * k} h={4 * k} c={LEAF} />
          <Dot
            x={head.x}
            y={head.y}
            d={(ripe ? 13 : 8) * k}
            h={(ripe ? 13 : 8) * k - sag}
            c={ripe ? fruit : LEAF}
          />
          {ripe && <Dot x={head.x} y={head.y} d={5 * k} h={5 * k - sag / 2} c="#6b4a2f" />}
        </>
      );
    }
    case 'pumpkin':
      return (
        <>
          <Box x={x - 11} y={y - 1 + sag / 2} w={22} h={2} c={LEAF_DARK} r={1} />
          <Dot x={x - 8} y={y - 3 + sag} d={8 * k} h={6 * k} c={LEAF} />
          <Dot x={x + 8} y={y + sag} d={8 * k} h={6 * k} c={LEAF} />
          <Dot
            x={x}
            y={y + sag / 2}
            d={(ripe ? 14 : 7) * k}
            h={(ripe ? 10 : 5) * k - sag / 2}
            c={ripe ? fruit : '#9fb76a'}
          />
          {ripe && <Box x={x - 0.75} y={y - 7 + sag} w={2} h={3.5} c="#6b5a3a" />}
        </>
      );
    case 'carrot':
    case 'radish':
      return (
        <>
          <Leaves
            x={x}
            y={y + sag / 2}
            size={9 - sag / 2}
            feathery={crop === 'carrot'}
            limp={limp}
            leaf={LEAF}
            dark={LEAF_DARK}
          />
          {ripe && <Dot x={x} y={y + 3} d={6 * k} h={4 * k} c={fruit} />}
        </>
      );
    default:
      // tomato, strawberry and anything new: a bushy plant with fruit.
      return (
        <>
          <Dot x={x - 4} y={y + sag / 2} d={10 * k} h={8 * k - sag} c={LEAF} />
          <Dot x={x + 4} y={y - 1 + sag / 2} d={10 * k} h={8 * k - sag} c={LEAF_DARK} />
          <Dot x={x} y={y - 4 + sag} d={9 * k} h={7 * k - sag} c={LEAF} />
          {ripe &&
            [
              [-5, 0],
              [3, -4],
              [5, 2],
              [-1, -2],
            ].map(([dx, dy]) => (
              <Dot
                key={`${dx}${dy}`}
                x={x + dx}
                y={y + dy + sag}
                d={(crop === 'strawberry' ? 2.8 : 3.6) * k}
                c={fruit}
              />
            ))}
        </>
      );
  }
}

function Sprout({
  x,
  y,
  size,
  leaf,
  dark,
  limp = false,
}: {
  x: number;
  y: number;
  size: number;
  leaf: string;
  dark: string;
  /** Withered: the leaves lie flat. */
  limp?: boolean;
}) {
  const h = size * (limp ? 0.38 : 0.6);
  const spread = limp ? 0.5 : 0.35;
  return (
    <>
      <Dot x={x - size * spread} y={y} d={size} h={h} c={leaf} />
      <Dot x={x + size * spread} y={y - size * 0.1} d={size} h={h} c={dark} />
    </>
  );
}

function Leaves({
  x,
  y,
  size,
  feathery,
  limp = false,
  leaf,
  dark,
}: {
  x: number;
  y: number;
  size: number;
  feathery: boolean;
  limp?: boolean;
  leaf: string;
  dark: string;
}) {
  if (feathery && limp)
    // Withered carrot tops flop over to either side.
    return (
      <>
        <Box x={x - size} y={y - 2} w={size} h={2} c={leaf} r={1} />
        <Box x={x} y={y - 3} w={size} h={2} c={dark} r={1} />
      </>
    );
  return feathery ? (
    <>
      {[-3, 0, 3].map((dx) => (
        <Box key={dx} x={x + dx - 1} y={y - size} w={2} h={size} c={leaf} r={1} />
      ))}
    </>
  ) : (
    <Sprout x={x} y={y - 2} size={size} leaf={leaf} dark={dark} limp={limp} />
  );
}

/** A 2 × 2 plot of raised beds; `plots` lists what's planted, plant by plant. */
export function AllotmentPlot({
  x,
  y,
  plots,
  wet,
  now,
}: {
  x: number;
  y: number;
  plots: Plot[];
  wet: boolean;
  now: number;
}) {
  return (
    <>
      {[0, 1, 2, 3].map((bed) => {
        const o = bedOrigin(x, y, bed);
        return (
          <RaisedBed
            key={bed}
            x={o.x}
            y={o.y}
            plants={plots.filter((p) => p.bed === bed)}
            wet={wet}
            now={now}
          />
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

/** A trestle table at the market, with crates of whatever's going. */
export function MarketTable({ x, y, goods }: { x: number; y: number; goods: string[] }) {
  return (
    <>
      <Shadow x={x + 35} y={y + 26} w={84} o={0.14} />
      <Box x={x + 4} y={y + 16} w={3} h={10} c="#6e5640" />
      <Box x={x + 63} y={y + 16} w={3} h={10} c="#6e5640" />
      <Box x={x} y={y} w={70} h={18} c="#b89870" r={2} />
      <Box x={x} y={y + 16} w={70} h={4} c="#94785a" r={1} />
      {goods.slice(0, 3).map((colour, i) => (
        <Crate key={i} x={x + 6 + i * 21} y={y - 8} colour={colour} />
      ))}
    </>
  );
}

function Crate({ x, y, colour }: { x: number; y: number; colour: string }) {
  return (
    <>
      <Box x={x} y={y} w={17} h={13} c="#a07c55" r={1.5} />
      <Box x={x} y={y + 6} w={17} h={1.5} c="#87663f" />
      {[3, 8.5, 14].map((dx) => (
        <Dot key={dx} x={x + dx} y={y + 2} d={5} c={colour} />
      ))}
    </>
  );
}

/** A chalkboard sign on legs. */
export function Sign({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 12} y={y + 30} w={30} />
      <Box x={x + 3} y={y + 18} w={2} h={12} c="#6e5640" />
      <Box x={x + 19} y={y + 18} w={2} h={12} c="#6e5640" />
      <Box
        x={x}
        y={y}
        w={24}
        h={20}
        c="#3f4643"
        r={2}
        style={{ borderWidth: 2, borderColor: '#8d6f50' }}
      />
      <Box x={x + 5} y={y + 6} w={14} h={1.5} c="#d9d6cf" o={0.8} />
      <Box x={x + 5} y={y + 11} w={10} h={1.5} c="#d9d6cf" o={0.6} />
    </>
  );
}

/**
 * A pillar box, for letters to friends. With post waiting for you, an
 * envelope peeks out of the slot.
 */
export function PostBox({ x, y, waiting }: { x: number; y: number; waiting: boolean }) {
  return (
    <>
      <Shadow x={x + 2} y={y} w={32} o={0.16} />
      <Box x={x - 12} y={y - 5} w={24} h={5} c="#3a3433" r={1} />
      <Box x={x - 11} y={y - 38} w={22} h={34} c="#b5524a" r={3} />
      <Box x={x - 11} y={y - 30} w={22} h={2} c="#9a433d" />
      <Dot x={x} y={y - 39} d={26} h={11} c="#a1463f" />
      <Dot x={x} y={y - 41} d={18} h={6} c="#b85a51" />
      <Box x={x - 7} y={y - 27} w={14} h={2.5} c="#3b2422" r={1} />
      <Box x={x - 5} y={y - 19} w={10} h={7} c="#ebe3d3" o={0.85} r={1} />
      {waiting && (
        <>
          <Box x={x - 5} y={y - 31} w={10} h={5} c="#f6f1e6" r={0.5} />
          <Box x={x - 5} y={y - 31} w={10} h={1.2} c="#d8cdb8" />
        </>
      )}
    </>
  );
}

/** The garden's noticeboard on two posts: friends and invites. (x, y) is the board's corner. */
export function GardenNoticeboard({ x, y }: { x: number; y: number }) {
  return (
    <>
      <Shadow x={x + 26} y={y + 48} w={64} o={0.12} />
      <Box x={x + 6} y={y + 28} w={4} h={20} c="#7a5f45" />
      <Box x={x + 42} y={y + 28} w={4} h={20} c="#7a5f45" />
      <Box x={x} y={y} w={52} h={32} c="#8f7151" r={2} />
      <Box x={x + 3} y={y + 3} w={46} h={26} c="#c49a6c" r={1} />
      {[
        [6, 6, '#efe8da'],
        [20, 9, '#e6d38f'],
        [33, 5, '#cfe0e6'],
        [13, 18, '#ead6d0'],
        [31, 17, '#efe8da'],
      ].map(([dx, dy, c]) => (
        <Box
          key={`${dx}${dy}`}
          x={x + (dx as number)}
          y={y + (dy as number)}
          w={10}
          h={8}
          c={c as string}
        />
      ))}
      <Box x={x - 2} y={y - 3} w={56} h={4} c="#6f5641" r={1} />
    </>
  );
}

/** A wheelie bin: (x, y) is its front-left corner on the ground. */
export function Bin({ x, y, colour }: { x: number; y: number; colour: string }) {
  return (
    <>
      <Shadow x={x + 12} y={y} w={30} o={0.16} />
      <Box x={x + 1} y={y - 28} w={22} h={26} c={colour} r={2} />
      <Box x={x - 1} y={y - 32} w={26} h={6} c={mix(colour, '#000000', 0.18)} r={2} />
      <Box x={x + 8} y={y - 31} w={8} h={1.5} c={mix(colour, '#ffffff', 0.25)} r={1} />
      <Dot x={x + 4} y={y - 1} d={5} c="#2c2c2e" />
      <Dot x={x + 20} y={y - 1} d={5} c="#2c2c2e" />
    </>
  );
}

/**
 * The low hedge along the front of the garden, with a gap for the gate, and
 * the tall hedges either side. `gateX` is the middle of the gap.
 */
export function Boundary({ y, gateX, width }: { y: number; gateX: number; width: number }) {
  const gap = 56;
  return (
    <>
      <Box x={BLEED.x} y={y} w={gateX - gap / 2 - BLEED.x} h={40} c={G.hedge} />
      <Box x={gateX + gap / 2} y={y} w={BLEED.x + BLEED.w - gateX - gap / 2} h={40} c={G.hedge} />
      {Array.from({ length: 128 }, (_, i) => {
        const x = -1980 + i * 34;
        return Math.abs(x - gateX) < gap / 2 + 12 ? null : (
          <Dot
            key={i}
            x={x}
            y={y + 2 + (i % 3) * 2}
            d={30}
            h={14}
            c={i % 2 ? '#6a8a63' : '#557352'}
          />
        );
      })}
      {/* Gateposts, and the gate swung open. */}
      <Box x={gateX - gap / 2 - 5} y={y - 14} w={6} h={30} c="#8d6f50" r={1} />
      <Box x={gateX + gap / 2 - 1} y={y - 14} w={6} h={30} c="#8d6f50" r={1} />
      <Box x={gateX + gap / 2 + 4} y={y - 8} w={4} h={22} c="#b19370" r={1} />
      {/* Tall hedges down both sides, past the ends of the garden. */}
      {[-140, width].map((x) => (
        <Box key={x} x={x} y={-400} w={140} h={y + 440} c={G.hedge}>
          {Array.from({ length: Math.floor((y + 30) / 28) }, (_, i) => (
            <Dot
              key={i}
              x={x < 0 ? 132 : 8}
              y={410 + i * 28}
              d={22}
              h={30}
              c={i % 2 ? '#6a8a63' : '#557352'}
            />
          ))}
        </Box>
      ))}
    </>
  );
}
