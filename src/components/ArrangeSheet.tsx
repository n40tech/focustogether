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
import { font, palette } from '@/lib/theme';

// Your desk, drawn S times bigger than in the office, its front-centre at
// (W / 2, Y0), with its drawer pulled open in front of it.
const S = 2.4;
const W = 260;
const Y0 = 176;
// The desk top, in desk units (mirrors the check on public.desk_layout).
const TOP = { left: -42, right: 42, back: -44, front: -12 };
/** The open drawer, in desk units: its inside, then its front. */
const DRAWER = { left: -44, right: 44, top: 0, bottom: 26, front: 6 };
/** Where things sit in the drawer, in a row. */
const DRAWER_Y = 21;
/** The i-th of n things in the drawer: spread out, closer together as it fills. */
const drawerX = (i: number, n: number) => -38 + i * Math.min(22, 76 / Math.max(1, n - 1));
/** Dropped lower than this (off the desk top, into the drawer), a thing is put away. */
const PUT_AWAY_Y = -6;
const NUDGE = 4;
const P = palette.office;

const nameOf = (slug: string) => itemInfo(slug).name.toLowerCase();
const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));

type Drag = { item: string; x: number; y: number; dx: number; dy: number; moved: boolean };

/**
 * Arranging your desk, between sessions. Its drawer is open: drag things
 * from it onto the desk, about the desk, or back into it to put them away.
 * For a keyboard: pick a thing by name, then move it with the arrows.
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
    ...drawer.map((item, i) => ({ item, x: drawerX(i, drawer.length), y: DRAWER_Y })),
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
    } else if (held && p.y < PUT_AWAY_Y) {
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
    if (drag.y > PUT_AWAY_Y) {
      if (wasOnDesk) putAway(drag.item);
    } else {
      place(drag.item, drag.x, drag.y);
    }
  };

  // What's drawn where: the thing being dragged follows your finger.
  const deskShown = onDesk.filter((t) => t.item !== drag?.item);
  const drawerShown = drawer
    .map((item, i) => ({ item, x: drawerX(i, drawer.length) }))
    .filter((t) => t.item !== drag?.item);
  /** A box given in desk units. */
  const box = (left: number, top: number, right: number, bottom: number) => ({
    x: W / 2 + left * S,
    y: Y0 + top * S,
    w: (right - left) * S,
    h: (bottom - top) * S,
  });

  return (
    <Sheet title="Your desk" onClose={onClose}>
      <View style={styles.list}>
        <Tip id="arrange">
          Your drawer is open. Drag things from it onto your desk, and drag them about to move them.
          Drag one back into the drawer to put it away.
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
          <Desk x={W / 2} y={Y0} items={deskShown} scale={S} chair={false} />
          {/* The gap in the desk's front where the drawer slid out, then the
              drawer, pulled open towards you: its sides and inside, then its front. */}
          <Box {...box(DRAWER.left, -9, DRAWER.right, -1)} c="#4a3a2b" r={1} />
          <Box
            {...box(DRAWER.left, DRAWER.top - 3, DRAWER.right, DRAWER.bottom)}
            c={P.desk}
            r={4}
          />
          <Box
            {...box(DRAWER.left + 3, DRAWER.top, DRAWER.right - 3, DRAWER.bottom - 1)}
            c="#8c6d4f"
            r={2}
          />
          {drawerShown.map((t) => (
            <DeskItem
              key={t.item}
              item={t.item}
              x={W / 2 + t.x * S}
              y={Y0 + DRAWER_Y * S}
              scale={S}
            />
          ))}
          <Box
            {...box(DRAWER.left, DRAWER.bottom, DRAWER.right, DRAWER.bottom + DRAWER.front)}
            c={P.deskTop}
            r={3}
          />
          <Box {...box(-8, DRAWER.bottom + 2, 8, DRAWER.bottom + 4)} c="#e4ddd0" r={2} />
          {drag && (
            <DeskItem item={drag.item} x={W / 2 + drag.x * S} y={Y0 + drag.y * S} scale={S} />
          )}
        </View>
        <Muted style={styles.center}>
          {fresh && drawer.includes(fresh)
            ? `Your new ${nameOf(fresh)} is in the drawer. Drag it onto your desk.`
            : drawer.length
              ? 'Drag things from the drawer onto your desk.'
              : 'Drag things about, or into the drawer to put them away.'}
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
  stage: {
    width: W,
    height: Y0 + (DRAWER.bottom + DRAWER.front + 2) * S,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  center: { textAlign: 'center' },
});
