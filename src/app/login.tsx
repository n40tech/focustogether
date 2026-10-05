import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Box } from '@/art/primitives';
import { Scene, useTone } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { BetaBanner } from '@/components/BetaBanner';
import { Button } from '@/components/Button';
import { Muted } from '@/components/Chrome';
import { api } from '@/lib/api';
import { formatInvite, normaliseInvite } from '@/lib/invites';
import { supabase, usernameToEmail } from '@/lib/supabase';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';

const C = palette.carpark;

/**
 * An invite link (/login?invite=CODE) opens the sign-up form. Read once as the
 * app loads on the web, because the router may rewrite the URL as it starts,
 * and forgotten once used, so logging out later shows the sign-in form.
 */
let inviteInUrl =
  Platform.OS === 'web' && typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('invite') ?? '')
    : '';

export default function Login() {
  useAmbience('quiet');
  const conditions = useConditions();
  const params = useLocalSearchParams<{ invite?: string }>();
  const [invite] = useState(() => normaliseInvite(params.invite || inviteInUrl));
  const [joining, setJoining] = useState(invite !== '');
  useEffect(() => {
    inviteInUrl = '';
  }, []);
  const art = (
    <>
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={i} x={29 + i * 60} y={120} w={2} h={92} c={C.line} o={0.6} />
      ))}
      <Box x={30} y={118} w={300} h={2} c={C.line} o={0.6} />
      {Array.from({ length: 6 }, (_, i) => (
        <Box key={`b${i}`} x={29 + i * 60} y={430} w={2} h={92} c={C.line} o={0.6} />
      ))}
      <Box x={30} y={428} w={300} h={2} c={C.line} o={0.6} />
    </>
  );
  return (
    <View style={styles.page}>
      <BetaBanner />
      <Scene
        conditions={conditions}
        ground={C.ground}
        outdoor
        art={art}
        reserve={{ top: 0, bottom: 0 }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.screen}
        >
          {joining ? (
            <Join invite={invite} onSignIn={() => setJoining(false)} />
          ) : (
            <SignIn onJoin={() => setJoining(true)} />
          )}
        </KeyboardAvoidingView>
      </Scene>
    </View>
  );
}

function SignIn({ onJoin }: { onJoin: () => void }) {
  const tone = useTone();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(username),
      password,
    });
    // On success the root layout's auth listener switches to the car park.
    if (error) {
      setError(
        error.message === 'Invalid login credentials' ? 'Wrong username or password' : error.message
      );
      setBusy(false);
    }
  };

  const input = [
    styles.input,
    { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
  ];
  return (
    <View style={[styles.card, { backgroundColor: tone.panel, borderColor: tone.line }]}>
      <Text style={[styles.title, { color: tone.text }]}>Focus Together</Text>
      <Muted style={styles.center}>Park up, study together, take your breaks in the garden.</Muted>
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor={tone.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        style={input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={tone.muted}
        secureTextEntry
        autoComplete="current-password"
        onSubmitEditing={signIn}
        returnKeyType="go"
        style={input}
      />
      {error && <Text style={{ color: tone.danger }}>{error}</Text>}
      <Button title="Arrive" onPress={signIn} disabled={busy || !username || !password} />
      <Switch label="Got an invite? Join" onPress={onJoin} />
    </View>
  );
}

/**
 * Sign-up, by invite only (the database refuses anyone without one): a friend
 * makes an invite on their noticeboard and sends you the link or code, and
 * you start out as friends.
 */
function Join({ invite, onSignIn }: { invite: string; onSignIn: () => void }) {
  const tone = useTone();
  const [code, setCode] = useState(formatInvite(invite));
  const [from, setFrom] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Say whose invite it is: for a code from a link straight away, and once a typed code is whole.
  useEffect(() => {
    if (normaliseInvite(invite).length < 8) return;
    let live = true;
    api.checkSignup(invite, 'nobody').then(
      (res) => {
        if (!live) return;
        setFrom(res.from ?? null);
        if (!res.from) setError(res.reason ?? null);
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [invite]);
  const checkCode = async (raw: string) => {
    if (normaliseInvite(raw).length < 8) return setFrom(null);
    try {
      const res = await api.checkSignup(raw, username || 'nobody');
      setFrom(res.from ?? null);
      setError(res.from ? null : (res.reason ?? null));
    } catch {
      setFrom(null);
    }
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const check = await api.checkSignup(code, username);
      if (!check.ok) throw new Error(check.reason ?? "That didn't work");
      if (password.length < 6) throw new Error('Passwords need at least 6 characters');
      const { data, error } = await supabase.auth.signUp({
        email: usernameToEmail(username),
        password,
        options: {
          data: {
            invite: normaliseInvite(code),
            username: username.trim().toLowerCase(),
            display_name: name.trim() || username.trim(),
          },
        },
      });
      if (error)
        throw new Error(
          error.message === 'Database error saving new user'
            ? "Couldn't join with that invite. It may have just been used."
            : error.message
        );
      // With a session, the root layout's auth listener takes you to the car park.
      if (!data.session)
        throw new Error(
          "Your account's made, but Focus Together needs email confirmation turned off before you can arrive."
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const input = [
    styles.input,
    { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
  ];
  return (
    <View style={[styles.card, { backgroundColor: tone.panel, borderColor: tone.line }]}>
      <Text style={[styles.title, { color: tone.text }]}>Join Focus Together</Text>
      <Muted style={styles.center}>
        {from
          ? `${from} invited you.`
          : 'Focus Together is invite-only for now. Enter your invite code.'}
      </Muted>
      <TextInput
        value={code}
        onChangeText={(t) => {
          setCode(formatInvite(t));
          checkCode(t);
        }}
        placeholder="Invite code"
        placeholderTextColor={tone.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        style={[...input, styles.code]}
      />
      <TextInput
        value={username}
        onChangeText={setUsername}
        placeholder="Username (how friends find you)"
        placeholderTextColor={tone.muted}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        style={input}
      />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Your name (shown to friends)"
        placeholderTextColor={tone.muted}
        autoComplete="name"
        style={input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={tone.muted}
        secureTextEntry
        autoComplete="new-password"
        onSubmitEditing={join}
        returnKeyType="go"
        style={input}
      />
      {error && <Text style={{ color: tone.danger }}>{error}</Text>}
      <Button
        title="Join"
        onPress={join}
        disabled={busy || normaliseInvite(code).length < 8 || !username.trim() || !password}
      />
      <Switch label="Already joined? Arrive" onPress={onSignIn} />
    </View>
  );
}

function Switch({ label, onPress }: { label: string; onPress: () => void }) {
  const tone = useTone();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8}>
      <Text style={[styles.switch, { color: tone.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  screen: { flex: 1, justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 380,
    alignSelf: 'center',
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 12,
  },
  title: { fontSize: 28, fontWeight: '300', textAlign: 'center', letterSpacing: 2 },
  center: { textAlign: 'center', marginBottom: 6 },
  code: { letterSpacing: 2, fontVariant: ['tabular-nums'] },
  switch: { textAlign: 'center', fontSize: 13, textDecorationLine: 'underline' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
