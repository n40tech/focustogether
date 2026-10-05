import { StyleSheet } from 'react-native';

import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Panel, SceneHeader } from '@/components/Chrome';
import { Noticeboard } from '@/components/Noticeboard';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { useGo, useWorld } from '@/world/World';

const C = palette.carpark;

export default function NoticeboardScreen() {
  useAmbience('carpark');
  const { me } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const art = (
    <>
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={1440} c={C.wall} />
      <Box x={14} y={20} w={332} h={600} c="#8f7151" r={6} />
      <Box x={24} y={30} w={312} h={580} c="#c49a6c" r={3} />
      {Array.from({ length: 14 }, (_, i) => (
        <Box
          key={i}
          x={40 + (i % 4) * 74 + ((i * 13) % 9)}
          y={50 + Math.floor(i / 4) * 140 + ((i * 7) % 15)}
          w={56}
          h={70}
          c={['#efe8da', '#e6d38f', '#cfe0e6', '#ead6d0'][i % 4]}
          o={0.55}
          style={{ transform: [{ rotate: `${((i * 37) % 9) - 4}deg` }] }}
        />
      ))}
      {Array.from({ length: 14 }, (_, i) => (
        <Dot
          key={i}
          x={68 + (i % 4) * 74 + ((i * 13) % 9)}
          y={54 + Math.floor(i / 4) * 140 + ((i * 7) % 15)}
          d={5}
          c="#b4574a"
          o={0.7}
        />
      ))}
    </>
  );

  return (
    <Scene conditions={conditions} ground={C.wall} art={art} reserve={{ top: 56, bottom: 0 }}>
      <SceneHeader place="Noticeboard" chips={me.chips} />
      <Panel style={styles.board}>
        <Noticeboard
          footer={
            <Button
              title="Back to the car park"
              variant="ghost"
              small
              style={styles.flex}
              onPress={() => go('/', null)}
            />
          }
        />
      </Panel>
    </Scene>
  );
}

const styles = StyleSheet.create({ board: { maxHeight: 600 }, flex: { flex: 1 } });
