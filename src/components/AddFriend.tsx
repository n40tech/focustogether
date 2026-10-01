import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from './Button';
import { api } from '@/lib/api';
import { colors } from '@/lib/theme';

export function AddFriend({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    if (!username.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.addFriend(username);
      setMessage({ text: `Added @${res.username}`, ok: true });
      setUsername('');
      onAdded();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <Button title="+ Add friend" variant="outline" onPress={() => setOpen(true)} />;
  }

  return (
    <View style={styles.box}>
      <View style={styles.row}>
        <TextInput
          value={username}
          onChangeText={setUsername}
          placeholder="Friend's username"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={submit}
          returnKeyType="done"
          style={styles.input}
        />
        <Button title="Add" onPress={submit} disabled={busy || !username.trim()} />
      </View>
      {message && (
        <Text style={{ color: message.ok ? '#2F7D4F' : colors.danger }}>{message.text}</Text>
      )}
      <Button
        title="Done"
        variant="ghost"
        onPress={() => {
          setOpen(false);
          setMessage(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
  },
});
