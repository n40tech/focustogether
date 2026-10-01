import { Desk, DeskGlow, OfficeWindow, PottedPlant } from '@/art/Office';
import { Person } from '@/art/People';
import { Box, Dot, Shadow, Tag } from '@/art/primitives';
import { BLEED, Scene } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { SceneHeader } from '@/components/Chrome';
import { StudyPanel } from '@/components/StudyPanel';
import { deskItemsOf } from '@/lib/catalog';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { useGo, useWorld } from '@/world/World';

const O = palette.office;

/** Friends' desks: three rows of three, behind yours. */
const DESKS = Array.from({ length: 9 }, (_, i) => ({
  x: 70 + (i % 3) * 110,
  y: 200 + Math.floor(i / 3) * 104,
}));
const MINE = { x: 180, y: 566, scale: 1.25 };
/** Windows all along the back wall, centred on the middle one. */
const WINDOWS = Array.from({ length: 33 }, (_, i) => 140 + (i - 16) * 112);

export default function Office() {
  useAmbience('office');
  const { me, friends, setMe, refresh } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const studying = me.status === 'focused';

  const desks = [...friends]
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, DESKS.length)
    .map((f, i) => ({ f, ...DESKS[i], on: f.status === 'focused' }));
  const myItems = deskItemsOf(me.inventory);

  const art = (
    <>
      {/* Back wall with frosted windows: the light comes in, but no sky. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={496} c={O.wall} />
      <Box x={BLEED.x} y={90} w={BLEED.w} h={6} c={O.skirting} />
      {WINDOWS.map((x) => (
        <OfficeWindow key={x} x={x} y={18} w={80} h={60} rain={conditions.weather.rain} />
      ))}
      <Surroundings />
      <PottedPlant x={14} y={132} size={1.1} />
      <PottedPlant x={346} y={132} size={1.1} />
      {/* Water cooler */}
      <Shadow x={346} y={430} w={24} />
      <Box x={336} y={396} w={20} h={34} c="#d9dcdf" r={3} />
      <Dot x={346} y={392} d={16} h={18} c="#a9c8da" />

      {desks.map(({ f, x, y, on }) => (
        <Desk key={f.username} x={x} y={y} occupant={on ? f.username : null} items={f.desk} />
      ))}

      {/* Your corner: a rug, your desk and, until you sit down, you. */}
      <Box x={70} y={470} w={220} h={130} c={O.rug} r={10} o={0.7} />
      <Desk
        x={MINE.x}
        y={MINE.y}
        occupant={studying ? me.username : null}
        items={myItems}
        scale={MINE.scale}
      />
      {!studying && <Person username={me.username} x={MINE.x + 84} y={MINE.y + 10} />}
    </>
  );

  const glow = (
    <>
      {desks.map(({ f, x, y, on }) => (
        <DeskGlow key={f.username} x={x} y={y} on={on} items={f.desk} />
      ))}
      <DeskGlow x={MINE.x} y={MINE.y} on={studying} items={myItems} scale={MINE.scale} />
    </>
  );

  const overlay = (
    <>
      {desks.map(({ f, x, y, on }) => (
        <Tag key={f.username} x={x} y={y + 14} text={f.display_name} dim={!on} />
      ))}
    </>
  );

  return (
    <Scene conditions={conditions} ground={O.ground} art={art} glow={glow} overlay={overlay}>
      <SceneHeader place="Office" chips={studying ? undefined : me.chips} />
      <StudyPanel me={me} setMe={setMe} refresh={refresh} onWalkOut={() => go('/')} />
    </Scene>
  );
}

/** The rest of the open-plan floor, seen on wide screens: shelves, a meeting table, plants. */
function Surroundings() {
  const spines = ['#8e4b4b', '#5f7f8f', '#c2a46e', '#6d8c78', '#a88cb5', '#d9c9b0'];
  return (
    <>
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
      <Box x={-260} y={300} w={160} h={84} c={O.deskTop} r={10} />
      {[-235, -195, -155].flatMap((x) => [
        <Box key={`t${x}`} x={x - 9} y={282} w={18} h={14} c={O.chair} r={5} />,
        <Box key={`b${x}`} x={x - 9} y={388} w={18} h={14} c={O.chair} r={5} />,
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
