/**
 * Server settings — pick the backend address this device talks to.
 *
 * Shown on the auth screen (a fresh install must be able to reach a LAN
 * backend BEFORE sign-in) and on Profile (change it later). Save runs a
 * real `GET /healthz` probe first, so we never persist a dead address.
 */
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import { getApiBase, probeApi, setApiBase } from '@/lib/server';

export function ServerSettings() {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(getApiBase());
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const ok = await probeApi(draft);
      if (!ok) {
        Alert.alert(
          'Server not reachable',
          `No answer from ${draft}/healthz.\n\nCheck that:\n• the backend is running (./start.sh)\n• this phone and the server are on the same network\n• the address uses the server's LAN IP, not localhost`,
        );
        return;
      }
      await setApiBase(draft);
      setEditing(false);
      Alert.alert('Connected', `Now using ${getApiBase()}`);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
        <Text
          onPress={() => {
            setDraft(getApiBase());
            setEditing(true);
          }}
          style={{ ...type.caption, color: colors.mutedForeground, textAlign: 'center' }}
        >
          Server: {getApiBase()} · <Text style={{ color: colors.primary }}>Change</Text>
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: 2 }}>
        Backend address (LAN IP of the machine running the API, port 4100)
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="http://192.168.1.20:4100"
        placeholderTextColor={colors.mutedForeground}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 6,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.sm,
          backgroundColor: colors.card,
          color: colors.foreground,
          fontSize: 15,
        }}
      />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="Test & save" onPress={() => void save()} loading={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Cancel"
            variant="secondary"
            onPress={() => setEditing(false)}
            disabled={busy}
          />
        </View>
      </View>
    </View>
  );
}
