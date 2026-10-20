import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { DESK_SPOTS, OfficeFloor, OfficeGlow } from '@/art/Office';
import { Hotspot, Tag } from '@/art/primitives';
import { Scene, useTone } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, SceneHeader, Sheet } from '@/components/Chrome';
import { Countdown } from '@/components/Countdown';
import { FriendOfFriendSheet } from '@/components/FriendOfFriendSheet';
import { StudyPanel } from '@/components/StudyPanel';
import { useTips } from '@/components/Tip';
import { api, type Friend, type Me } from '@/lib/api';
import { pageId } from '@/lib/away';
import { scheduleSessionEnd } from '@/lib/notifications';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';
import { seatsOf } from '@/world/seats';
import { useGo, useWorld } from '@/world/World';

export default function Office() {
  useAmbience('office');
  const { me, friends, friendsOfFriends, setMe, refresh } = useWorld();
  const conditions = useConditions();
  const go = useGo();
  const studying = me.status === 'focused';
  // The desk you tapped: a friend's, a friend of a friend's, or an empty one.
  const [tapped, setTapped] = useState<number | null>(null);

  // Walking in sits you at your desk: a random free one when you've just
  // arrived, kept until you go home. You stay there (for friends too) until you
  // get up and go somewhere.
  useEffect(() => {
    api.setPlace('office').then(setMe, () => {});
  }, [setMe]);
  // You found the office: the car park's welcome has done its job.
  const tips = useTips();
  const welcomed = tips.has('welcome');
  const doneTip = tips.done;
  useEffect(() => {
    if (!welcomed) doneTip('welcome');
  }, [welcomed, doneTip]);
  const walkOut = () => {
    api.setPlace('outside').then(setMe, () => {});
    go('/');
  };

  const seats = seatsOf(me, friends, friendsOfFriends);
  const seat = tapped === null ? null : seats[tapped];
  const friend = seat && !seat.via ? friends.find((f) => f.username === seat.username) : undefined;
  const close = () => setTapped(null);
  // You can move to an empty desk while you're at work, between sessions.
  const canMove = me.desk !== null && !studying;

  const overlay = (
    <>
      {DESK_SPOTS.map(({ x, y }, i) => {
        const seat = seats[i];
        if (!seat) return null;
        return (
          <Tag
            key={i}
            x={x}
            y={y + 14}
            text={seat.isMe ? 'You' : seat.display_name}
            dim={!seat.studying || !!seat.via}
          />
        );
      })}
      {DESK_SPOTS.map(({ x, y }, i) => {
        const seat = seats[i];
        if (seat?.isMe || (!seat && !canMove)) return null;
        return (
          <Hotspot
            key={i}
            x={x - 48}
            y={y - 72}
            w={96}
            h={96}
            label={seat ? `${seat.display_name}'s desk` : `Empty desk ${i + 1}`}
            onPress={() => setTapped(i)}
          />
        );
      })}
    </>
  );

  return (
    <Scene
      conditions={conditions}
      ground={palette.office.ground}
      art={<OfficeFloor seats={seats} rain={conditions.weather.rain} />}
      glow={<OfficeGlow seats={seats} />}
      overlay={overlay}
    >
      <SceneHeader place="Office" chips={studying ? undefined : me.chips} />
      <StudyPanel me={me} setMe={setMe} refresh={refresh} onWalkOut={walkOut} />
      {friend && (
        <DeskSheet
          friend={friend}
          canJoin={!studying}
          onJoined={(next) => {
            setMe(next);
            close();
          }}
          onClose={close}
        />
      )}
      {seat?.via && <FriendOfFriendSheet person={{ ...seat, via: seat.via }} onClose={close} />}
      {tapped !== null && !seat && canMove && (
        <EmptyDeskSheet
          desk={tapped}
          onSat={(next) => {
            setMe(next);
            close();
          }}
          onClose={close}
        />
      )}
    </Scene>
  );
}

/** An empty desk: sitting at it instead of yours. Your bay and rack slot move with you. */
function EmptyDeskSheet({
  desk,
  onSat,
  onClose,
}: {
  desk: number;
  onSat: (me: Me) => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sit = async () => {
    setBusy(true);
    setError(null);
    try {
      onSat(await api.switchDesk(desk));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <Sheet title={`Desk ${desk + 1}`} onClose={onClose}>
      <View style={{ gap: 10 }}>
        <Body>{"Nobody's at this desk. Your bay outside moves with you."}</Body>
        <Button title="Sit here" onPress={sit} disabled={busy} />
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
      </View>
    </Sheet>
  );
}

/** A friend's desk: how long they've got left, and joining them if they're studying. */
function DeskSheet({
  friend: f,
  canJoin,
  onJoined,
  onClose,
}: {
  friend: Friend;
  canJoin: boolean;
  onJoined: (me: Me) => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strong = { color: tone.text, fontWeight: '600' as const };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.joinSession(f.username, pageId);
      playSound('pop');
      const session = next.active_session;
      if (session) scheduleSessionEnd(new Date(session.ends_at), session.duration_min);
      onJoined(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={f.display_name} onClose={onClose}>
      <View style={{ gap: 10 }}>
        {f.status === 'focused' && f.ends_at ? (
          <Body>
            {'Studying: '}
            <Countdown until={f.ends_at} minutes style={strong} />
            {' left.'}
          </Body>
        ) : f.status === 'on_break' && f.break_ends_at ? (
          <Body>
            {'On a break: '}
            <Countdown until={f.break_ends_at} minutes style={strong} />
            {' left.'}
          </Body>
        ) : (
          <Body>
            {f.place === 'office' ? 'At their desk, between sessions.' : 'Away from their desk.'}
          </Body>
        )}
        {f.status === 'focused' && canJoin && (
          <>
            <Button title={`Join ${f.display_name}`} onPress={join} disabled={busy} />
            <Text style={{ color: tone.muted, fontSize: 13 }}>
              Your session ends when theirs does.
            </Text>
          </>
        )}
        {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
      </View>
    </Sheet>
  );
}
