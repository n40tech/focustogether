import { useEffect, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted, Panel, SceneHeader } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { api, type Friend, type Invite } from '@/lib/api';
import { personColour } from '@/lib/catalog';
import { formatInvite } from '@/lib/invites';
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
  const invites = useInvites();
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
        <InviteList invites={invites.list} onSend={invites.send} />
      </ScrollView>
      <AddFriend onAdded={onAdded} />
      {invites.message && (
        <Text style={{ color: invites.message.ok ? tone.accent : tone.danger, fontSize: 13 }}>
          {invites.message.text}
        </Text>
      )}
      <View style={styles.row}>
        <Button
          title="Make an invite"
          variant="quiet"
          small
          style={styles.flex}
          onPress={invites.make}
          disabled={invites.busy}
        />
        <Button
          title="Back to the car park"
          variant="ghost"
          small
          style={styles.flex}
          onPress={onLeave}
        />
      </View>
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

/** Where an invite link points: the sign-up form, with the code filled in. */
const inviteLink = (code: string) =>
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? `${window.location.origin}/login?invite=${code}`
    : null;

const until = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * Focus is invite-only: make an invite, send the link (or the code), and
 * whoever joins with it starts out as your friend.
 */
function useInvites() {
  const [list, setList] = useState<Invite[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    api.getInvites().then(setList, () => {});
  }, []);

  const send = async (code: string) => {
    const link = inviteLink(code);
    const text = `Come and study with me on Focus. Your invite code: ${formatInvite(code)}`;
    try {
      if (link && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(link);
        setMessage({
          text: `Invite link copied (${formatInvite(code)}). Send it to a friend.`,
          ok: true,
        });
      } else {
        await Share.share({ message: link ? `${text}\n${link}` : text });
      }
    } catch {
      setMessage({ text: link ?? text, ok: true });
    }
  };

  const make = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { code } = await api.createInvite();
      playSound('paper');
      setList(await api.getInvites());
      await send(code);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  return { list, busy, message, make, send };
}

function InviteList({ invites, onSend }: { invites: Invite[]; onSend: (code: string) => void }) {
  const tone = useTone();
  return (
    <View style={styles.invites}>
      <Text style={[font.label, { color: tone.muted }]}>Invites</Text>
      {invites.length === 0 && (
        <Muted>
          Focus is invite-only. Whoever joins with your invite starts out as your friend.
        </Muted>
      )}
      {invites.map((i) => (
        <View key={i.code} style={[styles.card, { borderColor: tone.line }]}>
          <Text style={[styles.code, { color: i.used_by ? tone.muted : tone.text }]}>
            {formatInvite(i.code)}
          </Text>
          <Muted style={styles.flex}>
            {i.used_by ? `${i.used_by} joined` : `Unused, until ${until(i.expires_at)}`}
          </Muted>
          {!i.used_by && (
            <Button
              title={inviteLink(i.code) ? 'Copy link' : 'Share'}
              small
              variant="quiet"
              onPress={() => onSend(i.code)}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  invites: { gap: 8, marginTop: 10 },
  code: { fontSize: 15, fontWeight: '600', letterSpacing: 1.5, fontVariant: ['tabular-nums'] },
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
