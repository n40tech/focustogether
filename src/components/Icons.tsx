import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';

import type { Conditions } from '@/weather/conditions';

/**
 * Small header icons, drawn from shapes like the rest of the placeholder art.
 * Each fits a 20 × 20 box; `bg` is the colour behind it, for the cut-outs.
 */
type Props = { color: string; bg?: string };

const SIZE = 20;

function Frame({ children }: { children: ReactNode }) {
  return (
    <View pointerEvents="none" style={{ width: SIZE, height: SIZE }}>
      {children}
    </View>
  );
}

/** An absolutely placed shape in the icon's 20 × 20 box. */
const at = (x: number, y: number, w: number, h: number, extra?: ViewStyle): ViewStyle => ({
  position: 'absolute',
  left: x,
  top: y,
  width: w,
  height: h,
  ...extra,
});

const disc = (cx: number, cy: number, d: number, c: string): ViewStyle =>
  at(cx - d / 2, cy - d / 2, d, d, { borderRadius: d / 2, backgroundColor: c });

/** Two people, one behind the other. */
export function FriendsIcon({ color }: Props) {
  return (
    <Frame>
      <View style={[disc(14, 5.5, 6, color), { opacity: 0.55 }]} />
      <View
        style={at(10, 10, 9, 7, {
          backgroundColor: color,
          opacity: 0.55,
          borderTopLeftRadius: 4.5,
          borderTopRightRadius: 4.5,
          borderBottomRightRadius: 1.5,
        })}
      />
      <View style={disc(7.5, 6.5, 7, color)} />
      <View
        style={at(1.5, 11.5, 12, 7.5, {
          backgroundColor: color,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          borderBottomLeftRadius: 1.5,
          borderBottomRightRadius: 1.5,
        })}
      />
    </Frame>
  );
}

/** A speaker, with sound waves when it's on and a cross when it's off. */
export function SoundIcon({ color, on }: Props & { on: boolean }) {
  const wave = (x: number, h: number): ViewStyle =>
    at(x, 10 - h / 2, h / 2, h, {
      borderWidth: 1.8,
      borderColor: 'transparent',
      borderRightColor: color,
      borderTopRightRadius: h / 2,
      borderBottomRightRadius: h / 2,
    });
  const bar = (deg: number): ViewStyle =>
    at(14, 6.5, 1.8, 7, {
      backgroundColor: color,
      borderRadius: 1,
      transform: [{ rotate: `${deg}deg` }],
    });
  return (
    <Frame>
      <View style={at(1.5, 7, 4, 6, { backgroundColor: color, borderRadius: 1 })} />
      <View
        style={at(3.5, 3.5, 0, 0, {
          borderTopWidth: 6.5,
          borderBottomWidth: 6.5,
          borderRightWidth: 6,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        })}
      />
      {on ? (
        <>
          <View style={wave(8, 7)} />
          <View style={wave(9, 13)} />
        </>
      ) : (
        <>
          <View style={bar(45)} />
          <View style={bar(-45)} />
        </>
      )}
    </Frame>
  );
}

/** A cog. */
export function GearIcon({ color, bg = 'transparent' }: Props) {
  return (
    <Frame>
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={at(8, 1, 4, 18, {
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${deg}deg` }],
          })}
        />
      ))}
      <View style={disc(10, 10, 13, color)} />
      <View style={disc(10, 10, 5, bg)} />
    </Frame>
  );
}

/** What the sky's doing: sun or moon, cloud, rain, storm or mist. */
export function WeatherIcon({
  color,
  bg = 'transparent',
  conditions,
}: Props & { conditions: Conditions }) {
  const { weather: w, light } = conditions;
  const night = light.daylight < 0.4;
  const sky = night ? (
    <Moon color={color} bg={bg} small={w.cloud > 0.4} />
  ) : (
    <Sun color={color} bg={bg} small={w.cloud > 0.4} />
  );
  if (w.storm > 0.35)
    return (
      <Frame>
        <Cloud color={color} y={-3} />
        <Bolt color={color} />
      </Frame>
    );
  if (w.rain > 0.06)
    return (
      <Frame>
        <Cloud color={color} y={-3} />
        <Drops color={color} heavy={w.rain > 0.25} />
      </Frame>
    );
  if (w.fog > 0.35)
    return (
      <Frame>
        {[4, 9, 14].map((y, i) => (
          <View
            key={y}
            style={at(i === 1 ? 1 : 3, y, i === 1 ? 18 : 14, 2, {
              backgroundColor: color,
              borderRadius: 1,
            })}
          />
        ))}
      </Frame>
    );
  if (w.cloud > 0.75)
    return (
      <Frame>
        <Cloud color={color} y={0} />
      </Frame>
    );
  if (w.cloud > 0.4)
    return (
      <Frame>
        {sky}
        <Cloud color={color} y={2} cut={bg} />
      </Frame>
    );
  return <Frame>{sky}</Frame>;
}

function Sun({ color, bg, small }: { color: string; bg: string; small: boolean }) {
  // Small and to one side when a cloud's in front of it.
  const [cx, cy, k] = small ? [7, 7, 0.7] : [10, 10, 1];
  return (
    <>
      {[0, 45, 90, 135].map((deg) => (
        <View
          key={deg}
          style={at(cx - 1, cy - 9 * k, 2, 18 * k, {
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${deg}deg` }],
          })}
        />
      ))}
      <View style={disc(cx, cy, 12 * k, bg)} />
      <View style={disc(cx, cy, 8 * k, color)} />
    </>
  );
}

function Moon({ color, bg, small }: { color: string; bg: string; small: boolean }) {
  const [cx, cy, d] = small ? [7, 7, 10] : [10, 10, 15];
  return (
    <>
      <View style={disc(cx, cy, d, color)} />
      <View style={disc(cx + d * 0.32, cy - d * 0.22, d * 0.8, bg)} />
    </>
  );
}

/** A cloud, `y` up or down from the middle; `cut` outlines it against what's behind. */
function Cloud({ color, y, cut }: { color: string; y: number; cut?: string }) {
  const parts = (c: string, grow: number) => (
    <>
      <View
        style={at(2 - grow, 11 + y - grow, 16 + grow * 2, 6 + grow * 2, {
          backgroundColor: c,
          borderRadius: 3 + grow,
        })}
      />
      <View style={disc(7.5, 11 + y, 8 + grow * 2, c)} />
      <View style={disc(12.5, 9.5 + y, 10 + grow * 2, c)} />
    </>
  );
  return (
    <>
      {cut && parts(cut, 1.5)}
      {parts(color, 0)}
    </>
  );
}

function Drops({ color, heavy }: { color: string; heavy: boolean }) {
  const xs = heavy ? [5, 9.5, 14] : [7, 12];
  return (
    <>
      {xs.map((x) => (
        <View
          key={x}
          style={at(x, 15, 1.8, 4.5, {
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: '20deg' }],
          })}
        />
      ))}
    </>
  );
}

function Bolt({ color }: { color: string }) {
  const stroke = (x: number, y: number, deg: number): ViewStyle =>
    at(x, y, 2, 5.5, {
      backgroundColor: color,
      borderRadius: 1,
      transform: [{ rotate: `${deg}deg` }],
    });
  return (
    <>
      <View style={stroke(10.5, 13.5, 25)} />
      <View style={stroke(9.5, 16, -60)} />
      <View style={stroke(8.5, 17.5, 25)} />
    </>
  );
}
