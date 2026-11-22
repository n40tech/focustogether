import { useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Panel } from '@/components/Chrome';
import { SceneHeader } from '@/components/Header';
import { Noticeboard } from '@/components/Noticeboard';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { useGo, useWorld } from '@/world/World';

const C = palette.carpark;

/** Back to wherever you came from (the header's Friends button says). */
const BACK: Record<string, { href: Href; label: string }> = {
  '/': { href: '/', label: 'Back to the car park' },
  '/office': { href: '/office', label: 'Back to the office' },
  '/garden': { href: '/garden', label: 'Back to the garden' },
  '/shop': { href: '/shop', label: 'Back to the shed' },
  '/payout': { href: '/payout', label: 'Back' },
};

export default function NoticeboardScreen() {
  useAmbience('carpark');
  const { me } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = BACK[from ?? '/'] ?? BACK['/'];
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
      <SceneHeader chips={me.chips} />
      <Panel style={styles.board}>
        <Noticeboard
          footer={
            <Button
              title={back.label}
              variant="ghost"
              small
              style={styles.flex}
              onPress={() => go(back.href, null)}
            />
          }
        />
      </Panel>
    </Scene>
  );
}

const styles = StyleSheet.create({ board: { maxHeight: 600 }, flex: { flex: 1 } });
