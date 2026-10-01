import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { api, type Friend } from '@/lib/api';
import { personColour } from '@/lib/catalog';
import { font, palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { useGo, useWorld } from '@/world/World';

const C = palette.carpark;
const WHERE: Record<Friend['status'], string> = {
  focused: 'Studying',
  on_break: 'In the garden',
  idle: 'Between sessions',
  absent: 'Away',
};

export default function Noticeboard() {
  useAmbience('carpark');
  const { me, friends, refresh } = useWorld();
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
      <Board friends={friends} onAdded={refresh} onLeave={() => go('/', null)} />
    </Scene>
  );
}

function Board({
  friends,
  onAdded,
  onLeave,
}: {
  friends: Friend[];
  onAdded: () => void;
  onLeave: () => void;
}) {
  const tone = useTone();
  return (
    <Panel style={styles.board}>
      <Text style={[font.label, { color: tone.muted }]}>Friends</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {friends.length === 0 && <Muted>No friends yet. Add someone by their username.</Muted>}
        {friends.map((f) => (
          <View
            key={f.username}
            style={[styles.card, { borderColor: tone.line, backgroundColor: tone.raised }]}
          >
            <View style={[styles.avatar, { backgroundColor: personColour(f.username) }]} />
            <View style={styles.flex}>
              <Text style={{ color: tone.text, fontSize: 15, fontWeight: '600' }}>
                {f.display_name}
              </Text>
              <Muted>@{f.username}</Muted>
            </View>
            <Text style={{ color: f.status === 'absent' ? tone.muted : tone.text, fontSize: 13 }}>
              {WHERE[f.status]}
              {f.status === 'focused' && f.ends_at ? (
                <>
                  {' · '}
                  <Countdown
                    until={f.ends_at}
                    minutes
                    style={{ color: tone.muted, fontSize: 13 }}
                  />
                  {' left'}
                </>
              ) : null}
            </Text>
          </View>
        ))}
      </ScrollView>
      <AddFriend onAdded={onAdded} />
      <Button title="Back to the car park" variant="ghost" small onPress={onLeave} />
    </Panel>
  );
}

function AddFriend({ onAdded }: { onAdded: () => void }) {
  const tone = useTone();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    if (!username.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.addFriend(username);
      setMessage({ text: `Pinned @${res.username} to the board.`, ok: true });
      setUsername('');
      playSound('paper');
      onAdded();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Friend's username"
          placeholderTextColor={tone.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submit}
          returnKeyType="done"
          style={[
            styles.input,
            { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
          ]}
        />
        <Button title="Add" small onPress={submit} disabled={busy || !username.trim()} />
      </View>
      {message && (
        <Text style={{ color: message.ok ? tone.accent : tone.danger, fontSize: 13 }}>
          {message.text}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  board: { maxHeight: 560 },
  list: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
});
