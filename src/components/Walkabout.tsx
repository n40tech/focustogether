import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, TextInput, View } from 'react-native';

import { ChatBubble } from '@/art/People';
import { Tag } from '@/art/primitives';
import { STAGE, useTone } from '@/art/Scene';
import { Button } from '@/components/Button';
import { serverNow } from '@/lib/clock';
import { type Point } from '@/world/gardenMap';
import { type Bubble, MAX_SAY, POS_EVERY_MS } from '@/world/useGardenChannel';
import { Whereabouts } from '@/world/whereabouts';

/** Pieces for places you walk about in: the garden and the car park. */

/** True until a cigarette lit until `until` burns out. */
export function useLit(until: string | null | undefined) {
  const [out, setOut] = useState<string | null>(null);
  useEffect(() => {
    if (!until) return;
    const id = setTimeout(() => setOut(until), Math.max(0, Date.parse(until) - serverNow()));
    return () => clearTimeout(id);
  }, [until]);
  return !!until && out !== until;
}

/** Moves the place, `width` stage units wide, under the stage as the camera pans. */
export function Pan({
  by,
  width,
  children,
}: {
  by: Animated.Value;
  width: number;
  children: ReactNode;
}) {
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.world, { width, transform: [{ translateX: by }] }]}
    >
      {children}
    </Animated.View>
  );
}

/** Draws its children at a friend's position, easing between the positions they send. */
export function Follow({
  whereabouts,
  who,
  home,
  children,
}: {
  whereabouts: Whereabouts;
  who: string;
  /** Where to stand them until we hear where they are. */
  home: Point;
  children: ReactNode;
}) {
  const [at] = useState(() => new Animated.ValueXY(whereabouts.get(who) ?? home));
  useEffect(
    () =>
      whereabouts.watch(who, (to) => {
        Animated.timing(at, {
          toValue: { x: to.x, y: to.y },
          duration: POS_EVERY_MS + 60,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start();
      }),
    [whereabouts, who, at]
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.figure, { transform: at.getTranslateTransform() }]}
    >
      {children}
    </Animated.View>
  );
}

/** A name under someone's feet, and what they're saying over their head. */
export function Label({ name, bubble }: { name: string; bubble?: Bubble }) {
  return (
    <>
      <Tag x={0} y={5} text={name} />
      {bubble && <ChatBubble key={bubble.id} x={0} y={-44} text={bubble.text} ttl={bubble.ttl} />}
    </>
  );
}

export function ChatBar({ onSay }: { onSay: (text: string) => boolean }) {
  const tone = useTone();
  const [text, setText] = useState('');
  const send = () => {
    if (onSay(text)) setText('');
  };
  return (
    <View style={styles.row}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Say something…"
        placeholderTextColor={tone.muted}
        maxLength={MAX_SAY}
        onSubmitEditing={send}
        returnKeyType="send"
        blurOnSubmit={false}
        style={[
          styles.input,
          { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
        ]}
      />
      <Button title="Say" small onPress={send} disabled={!text.trim()} />
    </View>
  );
}

export const walkabout = StyleSheet.create({
  /** Something drawn at a moving position: its own (0, 0) is the position. */
  figure: { position: 'absolute', left: 0, top: 0, width: STAGE.width, height: STAGE.height },
});

const styles = StyleSheet.create({
  world: { position: 'absolute', left: 0, top: 0, height: STAGE.height },
  figure: walkabout.figure,
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
});
