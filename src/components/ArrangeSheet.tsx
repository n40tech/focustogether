import { useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';

import { Desk, DeskItem } from '@/art/Office';
import { Box } from '@/art/primitives';
import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Sheet } from '@/components/Chrome';
import { Tip } from '@/components/Tip';
import { api, type Me } from '@/lib/api';
import { inTheDrawer, itemInfo } from '@/lib/catalog';
import { font } from '@/lib/theme';

// Your desk, drawn S times bigger than in the office, its front-centre at
// (W / 2, Y0), with the drawer's things laid out along the top.
const S = 2.4;
const W = 260;
const Y0 = 234;
const TRAY_H = 46;
// The desk top, in desk units (mirrors the check on public.desk_layout).
const TOP = { left: -42, right: 42, back: -44, front: -12 };
/** Where the drawer's things wait, in desk units: in a row above the desk. */
const TRAY_Y = -84;
const trayX = (i: number) => -42 + i * 12;
/** Dropped higher than this, a thing goes back in the drawer. */
const PUT_AWAY_Y = TOP.back - 8;
const NUDGE = 4;

const nameOf = (slug: string) => itemInfo(slug).name.toLowerCase();
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));

type Drag = { item: string; x: number; y: number; dx: number; dy: number; moved: boolean };

/**
 * Arranging your desk, between sessions. Drag things from the top onto the
 * desk, about the desk, or back up to the top to put them away. For a
 * keyboard: pick a thing by name, then move it with the arrows.
 */
export function ArrangeSheet({
  me,
  setMe,
  fresh,
  onClose,
}: {
  me: Me;
  setMe: (me: Me) => void;
  /** Something just bought, waiting at the top. */
  fresh?: string;
  onClose: () => void;
}) {
  const tone = useTone();
  const [held, setHeld] = useState<string | null>(fresh ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where the stage's top-left corner is on the page, found when a drag starts.
  const origin = useRef({ x: 0, y: 0 });

  const onDesk = me.desk_items;
  const drawer = inTheDrawer(me.inventory, onDesk);
  const heldThing = onDesk.find((t) => t.item === held);
  const spots = [
    ...onDesk.map((t) => ({ item: t.item, x: t.x, y: t.y })),
    ...drawer.map((item, i) => ({ item, x: trayX(i), y: TRAY_Y })),
  ];

  const run = async (action: () => Promise<Me>) => {
    setError(null);
    try {
      setMe(await action());
      playSound('paper');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const place = (item: string, x: number, y: number) =>
    run(() =>
      api.placeDeskItem(item, clamp(x, TOP.left, TOP.right), clamp(y, TOP.back, TOP.front))
    );
  const putAway = (item: string) => {
    setHeld(null);
    run(() => api.storeDeskItem(item));
  };

  /** A point on the stage, in desk units. */
  const at = (e: GestureResponderEvent) => ({
    x: (e.nativeEvent.pageX - origin.current.x - W / 2) / S,
    y: (e.nativeEvent.pageY - origin.current.y - Y0) / S,
  });

  const start = (e: GestureResponderEvent) => {
    const { pageX, pageY, locationX, locationY } = e.nativeEvent;
    origin.current = { x: pageX - locationX, y: pageY - locationY };
    const p = at(e);
    // Things are drawn up from where they stand, so aim for their middle.
    const hit = spots
      .map((s) => ({ s, d: Math.hypot(s.x - p.x, s.y - 5 - p.y) }))
      .filter(({ d }) => d < 12)
      .sort((a, b) => a.d - b.d)[0]?.s;
    if (hit) {
      setHeld(hit.item);
      setDrag({
        item: hit.item,
        x: hit.x,
        y: hit.y,
        dx: hit.x - p.x,
        dy: hit.y - p.y,
        moved: false,
      });
    } else if (held && p.y > PUT_AWAY_Y) {
      place(held, p.x, p.y);
    }
  };
  const move = (e: GestureResponderEvent) => {
    if (!drag) return;
    const p = at(e);
    const x = p.x + drag.dx;
    const y = p.y + drag.dy;
    setDrag({ ...drag, x, y, moved: drag.moved || Math.hypot(x - drag.x, y - drag.y) > 2 });
  };
  const end = () => {
    if (!drag) return;
    setDrag(null);
    if (!drag.moved) return;
    const wasOnDesk = onDesk.some((t) => t.item === drag.item);
    if (drag.y < PUT_AWAY_Y) {
      if (wasOnDesk) putAway(drag.item);
    } else {
      place(drag.item, drag.x, drag.y);
    }
  };

  // What's drawn where: the thing being dragged follows your finger.
  const deskShown = onDesk.filter((t) => t.item !== drag?.item);
  const trayShown = drawer
    .map((item, i) => ({ item, x: trayX(i) }))
    .filter((t) => t.item !== drag?.item);

  return (
    <Sheet title="Your desk" onClose={onClose}>
      <View style={styles.list}>
        <Tip id="arrange">
          Drag things from the top onto your desk, and drag them about to move them. Drag one back
          up to the top to put it away in the drawer.
        </Tip>
        <View
          accessibilityLabel="Your desk"
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={start}
          onResponderMove={move}
          onResponderRelease={end}
          onResponderTerminate={() => setDrag(null)}
          style={[styles.stage, Platform.OS === 'web' && ({ touchAction: 'none' } as object)]}
        >
          <Box x={0} y={0} w={W} h={TRAY_H} c={tone.raised} r={10} />
          {trayShown.map((t) => (
            <DeskItem
              key={t.item}
              item={t.item}
              x={W / 2 + t.x * S}
              y={Y0 + TRAY_Y * S}
              scale={S}
            />
          ))}
          <Desk x={W / 2} y={Y0} items={deskShown} scale={S} />
          {drag && (
            <DeskItem item={drag.item} x={W / 2 + drag.x * S} y={Y0 + drag.y * S} scale={S} />
          )}
        </View>
        <Muted style={styles.center}>
          {fresh && drawer.includes(fresh)
            ? `Your new ${nameOf(fresh)} is at the top. Drag it onto your desk.`
            : drawer.length
              ? 'Drag things from the top onto your desk.'
              : 'Drag things about, or up to the top to put them away.'}
        </Muted>
        <Text style={[font.label, { color: tone.muted }]}>Or pick one and move it</Text>
        <View style={styles.row}>
          {[...onDesk.map((t) => t.item), ...drawer].map((item) => (
            <Button
              key={item}
              title={itemInfo(item).name}
              variant={held === item ? 'primary' : 'quiet'}
              small
              onPress={() => setHeld(held === item ? null : item)}
            />
          ))}
        </View>
        {held && !heldThing && drawer.includes(held) && (
          <Button
            title="Put it on the desk"
            variant="quiet"
            small
            onPress={() => place(held, 0, -28)}
          />
        )}
        {heldThing && (
          <View style={styles.row}>
            {(
              [
                ['←', 'Move it left', -NUDGE, 0],
                ['↑', 'Move it back', 0, -NUDGE],
                ['↓', 'Move it forward', 0, NUDGE],
                ['→', 'Move it right', NUDGE, 0],
              ] as const
            ).map(([title, label, dx, dy]) => (
              <Button
                key={label}
                title={title}
                accessibilityLabel={label}
                variant="quiet"
                small
                onPress={() => place(heldThing.item, heldThing.x + dx, heldThing.y + dy)}
              />
            ))}
            <Button
              title="Put away"
              variant="quiet"
              small
              onPress={() => putAway(heldThing.item)}
            />
          </View>
        )}
        {onDesk.length + drawer.length === 0 && (
          <Muted>Nothing for your desk yet. The shed sells things for it.</Muted>
        )}
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
        <Button title="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  stage: { width: W, height: Y0 + 4, alignSelf: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { textAlign: 'center' },
});
