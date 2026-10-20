import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { ChipIcon, Muted } from '@/components/Chrome';
import { api, type Profile } from '@/lib/api';
import { formatSpan } from '@/lib/time';

/** "Just now", "45 minutes ago", "3 days ago". */
const ago = (iso: string) => {
  const ms = Date.now() - Date.parse(iso);
  return ms < 2 * 60_000 ? 'Just now' : `${formatSpan(ms)} ago`;
};

const since = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * A friend's profile: what they've studied, what they're worth, their friends,
 * and how long you've been friends. `lastActive` adds when they were last
 * about (on the Friends board).
 */
export function FriendProfile({
  username,
  lastActive,
}: {
  username: string;
  lastActive?: boolean;
}) {
  const tone = useTone();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getProfile(username).then(
      (p) => live && setProfile(p),
      (e) => live && setError(e instanceof Error ? e.message : String(e))
    );
    return () => {
      live = false;
    };
  }, [username]);

  if (error) return <Muted>{error}</Muted>;
  if (!profile) return null;

  const rows: [string, ReactNode][] = [
    ['Studied', `${profile.minutes_studied.toLocaleString()} minutes`],
    ['Days studied', profile.days_studied.toLocaleString()],
    ['Sessions', profile.sessions_studied.toLocaleString()],
    [
      'Net worth',
      <View key="worth" style={styles.worth}>
        <ChipIcon size={12} />
        <Text style={[styles.value, { color: tone.text }]}>
          {profile.net_worth.toLocaleString()}
        </Text>
      </View>,
    ],
    ['Friends', profile.friends.toLocaleString()],
    ['Friends in common', profile.in_common.toLocaleString()],
    ['Friends since', since(profile.friends_since)],
  ];
  if (lastActive)
    rows.push(['Last active', profile.last_active ? ago(profile.last_active) : 'Not yet']);
  return (
    <View style={styles.rows} accessibilityLabel={`${profile.display_name}'s profile`}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Muted style={styles.flex}>{label}</Muted>
          {typeof value === 'string' ? (
            <Text style={[styles.value, { color: tone.text }]}>{value}</Text>
          ) : (
            value
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  worth: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  value: { fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
});
