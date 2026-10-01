import { View } from 'react-native';

import { itemInfo } from '@/lib/catalog';
import { Crop } from './Garden';
import { DeskItem } from './Office';
import { Box, Dot } from './primitives';
import { Bike, Car } from './Vehicles';

/** A small picture of any item, built from the same placeholder art as the scenes. */
export function ItemIcon({ slug, size = 44 }: { slug: string; size?: number }) {
  const { kind, colour } = itemInfo(slug);
  const c = size / 2;
  let art;
  switch (kind) {
    case 'vehicle':
      art =
        slug === 'bike' ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: size,
              height: size,
              transform: [{ rotate: '90deg' }],
            }}
          >
            <Bike x={c} y={c + 20} />
          </View>
        ) : (
          <View
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: size,
              height: size,
              transform: [{ scale: 0.5 }, { rotate: '90deg' }],
            }}
          >
            <Car model={slug} x={c} y={c + 36} />
          </View>
        );
      break;
    case 'desk':
      art = <DeskItem item={slug} x={c} y={c + 12} scale={size / 22} />;
      break;
    case 'seed':
      // A seed packet with a picture of the crop.
      art = (
        <>
          <Box x={c - 13} y={c - 17} w={26} h={34} c="#efe6d2" r={3} />
          <Box x={c - 13} y={c - 17} w={26} h={8} c={colour} r={2} />
          <Dot x={c} y={c + 4} d={12} c={colour} />
          <Dot x={c + 3} y={c - 2} d={6} h={4} c="#6f9a5c" />
        </>
      );
      break;
    case 'produce':
      art = <Crop crop={slug} progress={1} ripe x={c} y={c + 6} />;
      break;
    default:
      // A pack of cigarettes.
      art = (
        <>
          <Box x={c - 10} y={c - 15} w={20} h={30} c="#f1ece2" r={2} />
          <Box x={c - 10} y={c - 15} w={20} h={9} c="#9a4b45" r={2} />
          {[-5, 0, 5].map((dx) => (
            <Box key={dx} x={c + dx - 1.5} y={c - 19} w={3} h={5} c="#efe9de" />
          ))}
        </>
      );
  }
  return <View style={{ width: size, height: size, overflow: 'hidden' }}>{art}</View>;
}
