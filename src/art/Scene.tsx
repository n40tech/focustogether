import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tones, type Tone } from '@/lib/theme';
import type { Conditions } from '@/weather/conditions';
import { nativeDriver } from './motion';
import { WeatherLayer } from './Weather';

/** Scenes are drawn on a 360 × 640 stage, scaled to fit between the UI bars. */
export const STAGE = { width: 360, height: 640 };
/** Backdrops (walls, roads, hedges) run this far past the stage, for wide screens. */
export const BLEED = { x: -2000, w: 4360 };

const ToneContext = createContext<Tone>(tones.day);
/** Warm paper by day, dim slate after dark: the UI follows the scene's light. */
export const useTone = () => use(ToneContext);

const PanelContext = createContext<(height: number) => void>(() => {});
/** Lets the bottom panel tell the scene how tall it is, so the stage fits above it. */
export const useReportPanelHeight = () => use(PanelContext);

type Props = {
  conditions: Conditions;
  /** Colour behind everything; scenes draw their own ground past the stage edges. */
  ground: string;
  /** Rain, ripples and cloud shadows fall on outdoor scenes only. */
  outdoor?: boolean;
  /** The scene, in stage units. Lit by the time of day. */
  art: ReactNode;
  /** Lamps, lit windows and screens, in stage units: they glow through the dark. */
  glow?: ReactNode;
  /** Name tags, chat bubbles and hotspots, in stage units, above the light (never tinted). */
  overlay?: ReactNode;
  /**
   * Space (px, below the safe area) the header and bottom UI need, so the stage
   * fits between them. A <Panel> reports its own height, which wins over `bottom`.
   */
  reserve?: { top: number; bottom: number };
  /** Told the stage's scale, and how wide the screen is in stage units, as they change. */
  onStage?: (stage: { scale: number; viewWidth: number }) => void;
  /** UI: header, panels and sheets, drawn above the scene and never tinted. */
  children?: ReactNode;
};

export function Scene({
  conditions,
  ground,
  outdoor = false,
  art,
  glow,
  overlay,
  reserve = { top: 56, bottom: 120 },
  onStage,
  children,
}: Props) {
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [panelHeight, setPanelHeight] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  };

  // Places fade in rather than slide: calmer, and the same on every platform.
  const [fade] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 650, useNativeDriver: nativeDriver }).start();
  }, [fade]);

  const top = insets.top + reserve.top;
  const bottom = panelHeight > 0 ? panelHeight : insets.bottom + reserve.bottom;
  const available = Math.max(1, size.height - top - bottom);
  const scale = Math.min(size.width / STAGE.width, available / STAGE.height);
  const stageStyle = {
    position: 'absolute' as const,
    width: STAGE.width,
    height: STAGE.height,
    left: (size.width - STAGE.width) / 2,
    top: top + (available - STAGE.height) / 2,
    transform: [{ scale }],
  };

  const viewWidth = scale > 0 ? size.width / scale : STAGE.width;
  useEffect(() => {
    if (scale > 0 && Number.isFinite(scale)) onStage?.({ scale, viewWidth });
  }, [scale, viewWidth, onStage]);

  const { light } = conditions;
  const tone = light.daylight < 0.4 ? tones.night : tones.day;

  return (
    <ToneContext value={tone}>
      <View style={[styles.root, { backgroundColor: ground }]} onLayout={onLayout}>
        {size.width > 0 && (
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
            <View pointerEvents="none" style={stageStyle}>
              {art}
            </View>
            <WeatherLayer conditions={conditions} size={size} outdoor={outdoor} />
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: light.tint.color, opacity: light.tint.opacity },
              ]}
            />
            {glow && (
              <View pointerEvents="none" style={[stageStyle, { opacity: light.glow }]}>
                {glow}
              </View>
            )}
            {overlay && (
              <View pointerEvents="box-none" style={stageStyle}>
                {overlay}
              </View>
            )}
          </Animated.View>
        )}
        <View
          pointerEvents="box-none"
          style={[StyleSheet.absoluteFill, { paddingTop: insets.top }]}
        >
          <PanelContext value={setPanelHeight}>{children}</PanelContext>
        </View>
      </View>
    </ToneContext>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
});

type Point = { x: number; y: number };

/**
 * Draws stage-unit art magnified `k` times so that the point `from` lands on
 * `to`: a closer look at part of a scene, with everything in proportion.
 */
export function Zoom({
  k,
  from,
  to,
  children,
}: {
  k: number;
  from: Point;
  to: Point;
  children: ReactNode;
}) {
  // Transforms scale about the view's centre.
  const cx = STAGE.width / 2;
  const cy = STAGE.height / 2;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: STAGE.width,
        height: STAGE.height,
        transform: [
          { translateX: to.x - cx - k * (from.x - cx) },
          { translateY: to.y - cy - k * (from.y - cy) },
          { scale: k },
        ],
      }}
    >
      {children}
    </View>
  );
}
