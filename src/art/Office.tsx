import { Animated } from 'react-native';

import { DESKS } from '@/lib/api';
import { palette } from '@/lib/theme';
import type { Seat } from '@/world/seats';
import { rand, useLoop } from './motion';
import { Person } from './People';
import { Box, Dot, Glow, Shadow } from './primitives';
import { BLEED } from './Scene';

const P = palette.office;

/** Twelve identical desks in four rows of three; nobody's is special. */
export const DESK_SPOTS = Array.from({ length: DESKS }, (_, i) => ({
  x: 70 + (i % 3) * 110,
  y: 200 + Math.floor(i / 3) * 110,
}));
/** Windows all along the back wall, centred on the middle one. */
const WINDOWS = Array.from({ length: 33 }, (_, i) => 140 + (i - 16) * 112);

/**
 * The open-plan floor and everyone at work on it, by desk (see seatsOf).
 * People sit at their desks while they study, and stay there afterwards until
 * they get up and go (to the garden, out, or home); you're at yours while
 * you're in the office. `closeUp` is your desk seen from just behind you, as
 * at the end of a session: you've pushed your chair back, and the screen's on.
 */
export function OfficeFloor({
  seats,
  rain,
  closeUp,
}: {
  seats: (Seat | null)[];
  rain: number;
  closeUp?: number;
}) {
  return (
    <>
      {/* Back wall with frosted windows: the light comes in, but no sky. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={496} c={P.wall} />
      <Box x={BLEED.x} y={90} w={BLEED.w} h={6} c={P.skirting} />
      {WINDOWS.map((x) => (
        <OfficeWindow key={x} x={x} y={18} w={80} h={60} rain={rain} />
      ))}
      <Surroundings />
      {DESK_SPOTS.map(({ x, y }, i) => {
        const seat = seats[i];
        const here = i === closeUp || seat?.isMe || seat?.atDesk;
        const sitting = seat && here ? seat.username : null;
        return (
          <Desk
            key={i}
            x={x}
            y={y}
            occupant={sitting}
            leanBack={i === closeUp ? 16 : 0}
            screenOn={i === closeUp || !!sitting}
            items={seat?.deskItems ?? []}
          />
        );
      })}
    </>
  );
}

/** The office's screens and desk lamps, for the glow layer. */
export function OfficeGlow({ seats, closeUp }: { seats: (Seat | null)[]; closeUp?: number }) {
  return (
    <>
      {DESK_SPOTS.map(({ x, y }, i) => (
        <DeskGlow
          key={i}
          x={x}
          y={y}
          on={i === closeUp || !!seats[i]?.studying}
          items={seats[i]?.deskItems ?? []}
        />
      ))}
    </>
  );
}

/** The rest of the open-plan floor, seen on wide screens: shelves, a meeting table, plants. */
function Surroundings() {
  const spines = ['#8e4b4b', '#5f7f8f', '#c2a46e', '#6d8c78', '#a88cb5', '#d9c9b0'];
  return (
    <>
      <PottedPlant x={14} y={132} size={1.1} />
      <PottedPlant x={346} y={132} size={1.1} />
      <PottedPlant x={14} y={600} size={1.2} />
      {/* Water cooler */}
      <Shadow x={346} y={620} w={24} />
      <Box x={336} y={586} w={20} h={34} c="#d9dcdf" r={3} />
      <Dot x={346} y={582} d={16} h={18} c="#a9c8da" />
      {[-330, 400].map((x0) =>
        [0, 1].map((k) => (
          <Box key={`${x0}-${k}`} x={x0 + k * 130} y={100} w={110} h={34} c="#9c8063" r={2}>
            {Array.from({ length: 12 }, (_, i) => (
              <Box
                key={i}
                x={4 + i * 8.6}
                y={4}
                w={6}
                h={26}
                c={spines[(i + k * 3) % spines.length]}
                r={1}
              />
            ))}
          </Box>
        ))
      )}
      <Box x={-255} y={305} w={160} h={84} c="#16181b" r={10} o={0.1} />
      <Box x={-260} y={300} w={160} h={84} c={P.deskTop} r={10} />
      {[-235, -195, -155].flatMap((x) => [
        <Box key={`t${x}`} x={x - 9} y={282} w={18} h={14} c={P.chair} r={5} />,
        <Box key={`b${x}`} x={x - 9} y={388} w={18} h={14} c={P.chair} r={5} />,
      ])}
      <PottedPlant x={-60} y={560} size={1.3} />
      <PottedPlant x={-300} y={520} size={1.1} />
      <PottedPlant x={420} y={560} size={1.3} />
      <Box x={460} y={250} w={70} h={110} c="#b4b9bd" r={3} />
      {[0, 1, 2].map((i) => (
        <Box key={i} x={466} y={258 + i * 34} w={58} h={28} c="#c7ccd0" r={2} />
      ))}
    </>
  );
}

/** Where things sit on a desk top, relative to the desk's front-centre. */
const SLOTS: [number, number][] = [
  [-36, -24],
  [36, -26],
  [-40, -38],
  [40, -38],
  [-24, -16],
  [24, -16],
  [-30, -44],
  [30, -44],
];

/**
 * A desk seen from above and in front, facing away from us. `x` is its centre
 * and `y` the bottom of its front edge. Someone sitting at it has their back to
 * us, with their monitor glowing beyond them.
 */
export function Desk({
  x,
  y,
  occupant,
  screenOn = !!occupant,
  leanBack = 0,
  items = [],
  scale = 1,
}: {
  x: number;
  y: number;
  /** Username of whoever is sitting here, if anyone. */
  occupant?: string | null;
  /** How far they've pushed their chair back from the desk, in desk units. */
  leanBack?: number;
  /** Whether the monitor is on; by default, whenever someone's sitting here. */
  screenOn?: boolean;
  items?: string[];
  scale?: number;
}) {
  const s = scale;
  const on = screenOn;
  return (
    <>
      <Box x={x - 45 * s} y={y - 42 * s} w={96 * s} h={46 * s} c="#16181b" r={4 * s} o={0.1} />
      {/* desk top and front edge */}
      <Box x={x - 48 * s} y={y - 46 * s} w={96 * s} h={36 * s} c={P.deskTop} r={3 * s} />
      <Box x={x - 48 * s} y={y - 11 * s} w={96 * s} h={10 * s} c={P.desk} r={2 * s} />
      {/* monitor on the far side, screen towards the sitter (and us) */}
      <Box x={x - 3 * s} y={y - 44 * s} w={6 * s} h={6 * s} c={P.monitor} />
      <Box x={x - 20 * s} y={y - 70 * s} w={40 * s} h={28 * s} c={P.monitor} r={3 * s} />
      <Box
        x={x - 17 * s}
        y={y - 67 * s}
        w={34 * s}
        h={22 * s}
        c={on ? P.screenOn : P.screen}
        r={2 * s}
      />
      {/* keyboard */}
      <Box x={x - 15 * s} y={y - 30 * s} w={30 * s} h={7 * s} c="#d8d2c6" r={2 * s} />
      {items.slice(0, SLOTS.length).map((item, i) => (
        <DeskItem
          key={item}
          item={item}
          x={x + SLOTS[i][0] * s}
          y={y + SLOTS[i][1] * s}
          scale={s}
        />
      ))}
      {occupant ? (
        <Person username={occupant} x={x} y={y + (12 + leanBack) * s} pose="sit" />
      ) : (
        // An empty chair, pushed in.
        <>
          <Box x={x - 13 * s} y={y - 8 * s} w={26 * s} h={14 * s} c={P.chair} r={6 * s} />
          <Box x={x - 11 * s} y={y + 5 * s} w={22 * s} h={4 * s} c="#4a515c" r={2 * s} />
        </>
      )}
    </>
  );
}

/** Screen and lamp light for a desk, drawn in the glow layer. */
export function DeskGlow({
  x,
  y,
  on,
  items = [],
  scale = 1,
}: {
  x: number;
  y: number;
  on: boolean;
  items?: string[];
  scale?: number;
}) {
  const s = scale;
  return (
    <>
      {on && (
        <>
          <Glow x={x} y={y - 46 * s} w={110 * s} h={60 * s} c="#bcd9ea" o={0.4} />
          <Box x={x - 17 * s} y={y - 67 * s} w={34 * s} h={22 * s} c="#d4ecf8" r={2 * s} />
        </>
      )}
      {items.slice(0, SLOTS.length).map((item, i) => {
        const [dx, dy] = SLOTS[i];
        if (item === 'lamp')
          return (
            <Glow
              key={item}
              x={x + dx * s}
              y={y + (dy - 4) * s}
              w={64 * s}
              h={40 * s}
              c="#ffd98a"
              o={0.6}
            />
          );
        if (item === 'lava_lamp')
          return (
            <Glow
              key={item}
              x={x + dx * s}
              y={y + (dy - 8) * s}
              w={32 * s}
              h={36 * s}
              c="#e7a3cf"
              o={0.6}
            />
          );
        return null;
      })}
    </>
  );
}

export function DeskItem({
  item,
  x,
  y,
  scale = 1,
}: {
  item: string;
  x: number;
  y: number;
  scale?: number;
}) {
  const s = scale;
  switch (item) {
    case 'mug':
      return (
        <>
          <Box x={x - 4 * s} y={y - 9 * s} w={8 * s} h={9 * s} c="#ebe6dc" r={2 * s} />
          <Box
            x={x + 3 * s}
            y={y - 7 * s}
            w={4 * s}
            h={5 * s}
            r={2 * s}
            style={{ borderWidth: 1.5 * s, borderColor: '#ebe6dc' }}
          />
          <Dot x={x} y={y - 9 * s} d={7 * s} h={3 * s} c="#5b4030" />
        </>
      );
    case 'duck':
      return (
        <>
          <Dot x={x} y={y - 4 * s} d={10 * s} h={8 * s} c="#e8c547" />
          <Dot x={x + 3 * s} y={y - 9 * s} d={6 * s} c="#ecd05a" />
          <Box x={x + 5.5 * s} y={y - 10 * s} w={3 * s} h={2 * s} c="#e08a3a" r={1} />
        </>
      );
    case 'succulent':
      return (
        <>
          <Box x={x - 5 * s} y={y - 6 * s} w={10 * s} h={6 * s} c="#c07a55" r={1.5 * s} />
          <Dot x={x - 3 * s} y={y - 8 * s} d={5 * s} c="#7fa37a" />
          <Dot x={x + 2 * s} y={y - 9 * s} d={6 * s} c="#8db487" />
          <Dot x={x} y={y - 11 * s} d={5 * s} c="#6f9669" />
        </>
      );
    case 'photo':
      return (
        <>
          <Box x={x - 5 * s} y={y - 13 * s} w={10 * s} h={12 * s} c="#a68a6d" r={1} />
          <Box x={x - 3.5 * s} y={y - 11.5 * s} w={7 * s} h={8 * s} c="#d7e0e2" />
          <Dot x={x} y={y - 8 * s} d={4 * s} c="#9fb2a0" />
        </>
      );
    case 'lamp':
      return (
        <>
          <Dot x={x} y={y - 1 * s} d={9 * s} h={3 * s} c="#5d6b73" />
          <Box x={x - 1 * s} y={y - 15 * s} w={2 * s} h={14 * s} c="#5d6b73" />
          <Box x={x - 6 * s} y={y - 20 * s} w={12 * s} h={6 * s} c="#4f5b62" r={3 * s} />
        </>
      );
    case 'lava_lamp':
      return (
        <>
          <Box x={x - 3 * s} y={y - 3 * s} w={6 * s} h={3 * s} c="#4b4b52" r={1} />
          <Box x={x - 3 * s} y={y - 17 * s} w={6 * s} h={14 * s} c="#b46a9a" r={3 * s} />
          <Dot x={x} y={y - 12 * s} d={3 * s} c="#e6a7cf" />
          <Dot x={x - 1 * s} y={y - 7 * s} d={2.5 * s} c="#e6a7cf" />
        </>
      );
    case 'radio':
      return (
        <>
          <Box x={x + 4 * s} y={y - 18 * s} w={1 * s} h={9 * s} c="#7a7a7a" />
          <Box x={x - 8 * s} y={y - 10 * s} w={16 * s} h={10 * s} c="#8a6a4f" r={2 * s} />
          <Box x={x - 6 * s} y={y - 8 * s} w={7 * s} h={6 * s} c="#5a4434" r={1} />
          <Dot x={x + 4 * s} y={y - 5 * s} d={4 * s} c="#e3d7c3" />
        </>
      );
    case 'bonsai':
      return (
        <>
          <Box x={x - 6 * s} y={y - 5 * s} w={12 * s} h={5 * s} c="#6b5a4a" r={1} />
          <Box x={x - 1 * s} y={y - 11 * s} w={2 * s} h={6 * s} c="#6b4a33" />
          <Dot x={x - 1 * s} y={y - 14 * s} d={16 * s} h={9 * s} c="#5e8a5a" />
          <Dot x={x + 4 * s} y={y - 16 * s} d={9 * s} h={6 * s} c="#6f9a6a" />
        </>
      );
    default:
      return <Dot x={x} y={y - 4 * s} d={8 * s} c="#b9b2a6" />;
  }
}

function Drip({ x, top, height, i }: { x: number; top: number; height: number; i: number }) {
  const t = useLoop(3500 + Math.round(rand(i, 5) * 3000), { delay: Math.round(rand(i, 6) * 4000) });
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top,
        width: 2,
        height: 5,
        borderRadius: 1,
        backgroundColor: '#eef3f6',
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.9, 1], outputRange: [0, 0.8, 0.6, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height - 5] }) },
        ],
      }}
    />
  );
}

/**
 * A frosted office window with blinds half down: it lets the light in (and the
 * sound of the rain) but shows no sky. Rain runs down the glass.
 */
export function OfficeWindow({
  x,
  y,
  w,
  h,
  rain,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  rain: number;
}) {
  const drips = rain > 0.04 ? Math.round(3 + 12 * rain) : 0;
  return (
    <>
      <Box x={x - 3} y={y - 3} w={w + 6} h={h + 6} c="#f3eee6" r={3} />
      <Box x={x} y={y} w={w} h={h} c={P.window} r={2} />
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={i} x={x} y={y + i * 5} w={w} h={3.5} c={P.blind} />
      ))}
      <Box x={x + w / 2 - 1} y={y} w={2} h={h} c="#f3eee6" />
      {Array.from({ length: drips }, (_, i) => (
        <Drip key={i} x={x + 3 + rand(i, 7) * (w - 6)} top={y + 30} height={h - 30} i={i} />
      ))}
    </>
  );
}

export function PottedPlant({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  const s = size;
  return (
    <>
      <Shadow x={x} y={y} w={26 * s} />
      <Box x={x - 9 * s} y={y - 14 * s} w={18 * s} h={14 * s} c="#b9805c" r={3 * s} />
      <Dot x={x - 7 * s} y={y - 22 * s} d={14 * s} c="#6f8f68" />
      <Dot x={x + 6 * s} y={y - 24 * s} d={16 * s} c="#7b9b73" />
      <Dot x={x} y={y - 32 * s} d={14 * s} c="#668761" />
    </>
  );
}
