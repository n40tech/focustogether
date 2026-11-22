import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useTone } from '@/art/Scene';
import { Button } from '@/components/Button';
import { Muted } from '@/components/Chrome';
import { api } from '@/lib/api';
import { isEmail } from '@/lib/email';
import { font } from '@/lib/theme';
import { useWorld } from '@/world/World';

/**
 * Your email, for news of Focus Together, in settings: add it if you joined
 * before we asked, or change it.
 */
export function EmailBox() {
  const tone = useTone();
  const { me, setMe } = useWorld();
  const [editing, setEditing] = useState(!me.email);
  const [email, setEmail] = useState(me.email ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!isEmail(email)) return setError("That doesn't look like a real email address");
    setBusy(true);
    setError(null);
    try {
      setMe(await api.setEmail(email));
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.box}>
      <Text style={[font.label, { color: tone.muted }]}>Email</Text>
      {!editing && me.email ? (
        <View style={styles.row}>
          <Muted
            style={styles.flex}
          >{`News of Focus Together goes to ${me.email}. Only you can see it.`}</Muted>
          <Button title="Change" small variant="quiet" onPress={() => setEditing(true)} />
        </View>
      ) : (
        <>
          <Muted>For news of Focus Together. Only you can see it.</Muted>
          <View style={styles.row}>
            <TextInput
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                setError(null);
              }}
              placeholder="you@example.com"
              placeholderTextColor={tone.muted}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              keyboardType="email-address"
              accessibilityLabel="Your email"
              onSubmitEditing={save}
              style={[
                styles.input,
                { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
              ]}
            />
            <Button title="Save" small onPress={save} disabled={busy || !email.trim()} />
          </View>
        </>
      )}
      {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
  },
});
