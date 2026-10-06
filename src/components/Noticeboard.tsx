import { useEffect, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { forgetTips } from '@/components/Tip';
import { api, type Friend, type Invite } from '@/lib/api';
import { personColour } from '@/lib/catalog';
import { formatInvite } from '@/lib/invites';
import { font } from '@/lib/theme';
import { useWorld } from '@/world/World';

const WHERE: Record<Friend['status'], string> = {
  focused: 'Studying',
  on_break: 'In the garden',
  idle: 'Between sessions',
  absent: 'Away',
};

/**
 * The noticeboard: your friends and where they are, adding a friend by their
 * username, and invites. On the wall in the car park, and on posts in the
 * garden. `footer` goes beside "Make an invite".
 */
export function Noticeboard({ footer }: { footer?: ReactNode }) {
  const tone = useTone();
  const { friends, refresh, setMe } = useWorld();
  const invites = useInvites();
  // Unpinning someone starts the add-a-friend box afresh, so an old "Pinned" note goes.
  const [unpinned, setUnpinned] = useState(0);
  const removed = () => {
    setUnpinned((n) => n + 1);
    refresh();
  };
  return (
    <>
      <Text style={[font.label, { color: tone.muted }]}>Friends</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {friends.length === 0 && <Muted>No friends yet. Add someone by their username.</Muted>}
        {friends.map((f) => (
          <FriendCard key={f.username} friend={f} onRemoved={removed} />
        ))}
        <InviteList invites={invites.list} onSend={invites.send} />
        <Button
          title="Show the tips for new players again"
          variant="ghost"
          small
          onPress={() => {
            forgetTips();
            api.resetTips().then(setMe, () => {});
          }}
        />
      </ScrollView>
      <AddFriend key={unpinned} onAdded={refresh} />
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
        {footer}
      </View>
    </>
  );
}

/**
 * A friend on the board. "Unpin" asks first, then ends the friendship both
 * ways (offers between you are called off; letters stay).
 */
function FriendCard({ friend: f, onRemoved }: { friend: Friend; onRemoved: () => void }) {
  const tone = useTone();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.removeFriend(f.username);
      playSound('paper');
      onRemoved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={[styles.friend, { borderColor: tone.line, backgroundColor: tone.raised }]}>
      <View style={styles.row}>
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
              <Countdown until={f.ends_at} minutes style={{ color: tone.muted, fontSize: 13 }} />
              {' left'}
            </>
          ) : null}
        </Text>
        {!asking && (
          <Button
            title="Unpin"
            variant="ghost"
            small
            accessibilityLabel={`Unpin ${f.display_name}`}
            onPress={() => setAsking(true)}
          />
        )}
      </View>
      {asking && (
        <View style={{ gap: 6 }}>
          <Muted>
            Take {f.display_name} off your board? You&apos;ll both stop seeing each other, and any
            offers between you are called off. You can add them again later.
          </Muted>
          {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
          <View style={styles.row}>
            <Button
              title="Unpin"
              variant="danger"
              small
              accessibilityLabel={`Yes, unpin ${f.display_name}`}
              onPress={remove}
              disabled={busy}
            />
            <Button title="Keep" variant="quiet" small onPress={() => setAsking(false)} />
          </View>
        </View>
      )}
    </View>
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
    const text = `Come and study with me on Focus Together. Your invite code: ${formatInvite(code)}`;
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
          Focus Together is invite-only. Whoever joins with your invite starts out as your friend.
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
  list: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  friend: { gap: 8, padding: 10, borderRadius: 12, borderWidth: 1 },
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
