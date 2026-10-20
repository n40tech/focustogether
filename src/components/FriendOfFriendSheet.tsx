import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { playSound } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Sheet } from '@/components/Chrome';
import { listOf } from '@/components/Noticeboard';
import { api } from '@/lib/api';
import { useWorld } from '@/world/World';

type State = 'loading' | 'not asked' | 'asked' | 'they asked' | 'friends';

/** A friend of a friend, at their desk or by their car: who you both know, and asking to be friends. */
export function FriendOfFriendSheet({
  person,
  onClose,
}: {
  person: { username: string; display_name: string; via: string[] };
  onClose: () => void;
}) {
  const tone = useTone();
  const { refresh } = useWorld();
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const name = person.display_name;

  useEffect(() => {
    api.getFriendRequests().then(
      (r) =>
        setState(
          r.from_you.some((x) => x.username === person.username)
            ? 'asked'
            : r.to_you.some((x) => x.username === person.username)
              ? 'they asked'
              : 'not asked'
        ),
      () => setState('not asked')
    );
  }, [person.username]);

  const ask = async () => {
    setError(null);
    try {
      const res = await api.addFriend(person.username);
      playSound('paper');
      setState(res.friends ? 'friends' : 'asked');
      if (res.friends) refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Sheet title={name} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <Body>{`@${person.username} · friends with ${listOf(person.via)}`}</Body>
        {state === 'not asked' && <Button title="Ask to be friends" onPress={ask} />}
        {state === 'they asked' && (
          <>
            <Muted>{`${name} has asked to be friends.`}</Muted>
            <Button title={`Accept ${name}`} onPress={ask} />
          </>
        )}
        {state === 'asked' && (
          <Muted>{`Asked. ${name} will be on your Friends board once they say yes.`}</Muted>
        )}
        {state === 'friends' && <Muted>{`You and ${name} are friends now.`}</Muted>}
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
      </View>
    </Sheet>
  );
}
