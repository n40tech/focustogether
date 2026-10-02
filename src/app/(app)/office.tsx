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

  // Walking in sits you at your desk: a random free one when you've just
  // arrived, kept until you go home. You stay there (for friends too) until you
  // get up and go somewhere.
  useEffect(() => {
    api.setPlace('office').then(setMe, () => {});
  }, [setMe]);
  const walkOut = () => {
    api.setPlace('outside').then(setMe, () => {});
    go('/');
  };

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
      <StudyPanel me={me} setMe={setMe} refresh={refresh} onWalkOut={walkOut} />
    </Scene>
  );
}
