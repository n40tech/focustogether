import { useRef, useState } from 'react';
import { Animated, View } from 'react-native';

import { useTone } from '@/art/Scene';
import type { Direction } from '@/world/useWalker';

const STILL = { x: 0, y: 0 };

/**
 * A thumbstick: press anywhere on it and drag. Reports a direction whose
 * length (0–1) is how far the knob is pushed.
 */
export function Joystick({
  size = 92,
  onChange,
}: {
  size?: number;
  onChange: (direction: Direction) => void;
}) {
  const tone = useTone();
  const [knob] = useState(() => new Animated.ValueXY());
  const knobSize = size * 0.42;
  const travel = (size - knobSize) / 2;

  /** The middle of the stick on the page, found when a drag starts. */
  const centre = useRef(STILL);

  const update = (pageX: number, pageY: number) => {
    let dx = pageX - centre.current.x;
    let dy = pageY - centre.current.y;
    const d = Math.hypot(dx, dy);
    if (d > travel) {
      dx = (dx / d) * travel;
      dy = (dy / d) * travel;
    }
    knob.setValue({ x: dx, y: dy });
    // A small dead zone, so resting a thumb on it doesn't wander.
    onChange(d < travel * 0.18 ? STILL : { x: dx / travel, y: dy / travel });
  };
  const release = () => {
    Animated.spring(knob, {
      toValue: STILL,
      friction: 7,
      tension: 80,
      useNativeDriver: false,
    }).start();
    onChange(STILL);
  };

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        // The knob ignores touches, so this is relative to the base.
        const { pageX, pageY, locationX, locationY } = e.nativeEvent;
        centre.current = { x: pageX - locationX + size / 2, y: pageY - locationY + size / 2 };
        update(pageX, pageY);
      }}
      onResponderMove={(e) => update(e.nativeEvent.pageX, e.nativeEvent.pageY)}
      onResponderRelease={release}
      onResponderTerminate={release}
      accessibilityLabel="Walk: drag to move, or use the arrow keys"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: tone.line,
        backgroundColor: tone.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Four faint marks for the directions. */}
      {[0, 90, 180, 270].map((deg) => (
        <View
          key={deg}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: tone.line,
            transform: [{ rotate: `${deg}deg` }, { translateY: -(size / 2 - 9) }],
          }}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={{
          width: knobSize,
          height: knobSize,
          borderRadius: knobSize / 2,
          backgroundColor: tone.accent,
          opacity: 0.85,
          transform: knob.getTranslateTransform(),
        }}
      />
    </View>
  );
}
