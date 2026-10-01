import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { Box } from '@/art/primitives';
import { Scene, useTone } from '@/art/Scene';
import { useAmbience } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Muted } from '@/components/Chrome';
import { supabase, usernameToEmail } from '@/lib/supabase';
import { palette } from '@/lib/theme';
import { useConditions } from '@/weather/useConditions';

const C = palette.carpark;

export default function Login() {
  useAmbience('quiet');
  const conditions = useConditions();
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
        <SignIn />
      </KeyboardAvoidingView>
    </Scene>
  );
}

function SignIn() {
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
      <Text style={[styles.title, { color: tone.text }]}>Focus</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
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
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
});
