import { useEffect } from 'react';

import { DESK_SPOTS, OfficeFloor, OfficeGlow } from '@/art/Office';
import { Tag } from '@/art/primitives';
import { Scene } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { SceneHeader } from '@/components/Chrome';
import { StudyPanel } from '@/components/StudyPanel';
import { api } from '@/lib/api';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { seatsOf } from '@/world/seats';
import { useGo, useWorld } from '@/world/World';

export default function Office() {
  useAmbience('office');
  const { me, friends, setMe, refresh } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const studying = me.status === 'focused';

  // Walking in hands you a random free desk, kept until you go home.
  const atWork = me.desk !== null;
  useEffect(() => {
    if (!atWork) api.arrive().then(setMe, () => {});
  }, [atWork, setMe]);

  const seats = seatsOf(me, friends);

  const overlay = (
    <>
      {DESK_SPOTS.map(({ x, y }, i) => {
        const seat = seats[i];
        if (!seat) return null;
        return (
          <Tag
            key={i}
            x={x}
            y={y + 14}
            text={seat.isMe ? 'You' : seat.display_name}
            dim={!seat.studying}
          />
        );
      })}
    </>
  );

  return (
    <Scene
      conditions={conditions}
      ground={palette.office.ground}
      art={<OfficeFloor seats={seats} rain={conditions.weather.rain} />}
      glow={<OfficeGlow seats={seats} />}
      overlay={overlay}
    >
      <SceneHeader place="Office" chips={studying ? undefined : me.chips} />
      <StudyPanel me={me} setMe={setMe} refresh={refresh} onWalkOut={() => go('/')} />
    </Scene>
  );
}
