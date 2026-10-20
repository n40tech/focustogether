import { View } from 'react-native';

import { Person } from '@/art/People';
import { useTone } from '@/art/Scene';

/** Stage units shown across the circle. */
const SPAN = 22;

/** Someone's face in a circle: their character's head and shoulders, as they look. */
export function Face({ username, size = 30 }: { username: string; size?: number }) {
  const tone = useTone();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: tone.raised,
        borderWidth: 1,
        borderColor: tone.line,
      }}
    >
      {/* A SPAN-wide piece of stage, scaled to the circle, with the head just above its middle. */}
      <View
        style={{
          position: 'absolute',
          left: (size - SPAN) / 2,
          top: (size - SPAN) / 2,
          width: SPAN,
          height: SPAN,
          transform: [{ scale: size / SPAN }],
        }}
      >
        <Person username={username} x={SPAN / 2} y={SPAN / 2 - 1.5 + 33} />
      </View>
    </View>
  );
}
