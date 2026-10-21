/**
 * Server settings — pick the backend address this device talks to.
 *
 * Two slots: `api` (NestJS on 4100 — shown on the traveller auth screen)
 * and `admin` (staff console on 3001 — shown in the admin APK header).
 * Editable BEFORE sign-in so a fresh install can reach a LAN backend on
 * first launch. Save runs a real probe first (`/healthz` for the API, `/`
 * for the console) so we never persist a dead address.
 */
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import {
  getAdminBase,
  getApiBase,
  normalizeBase,
  probeApi,
  probeWeb,
  setServerBase,
  slotLabel,
  type ServerSlot,
} from '@/lib/server';

export function ServerSettings({
  slot = 'api',
  onChanged,
}: {
  slot?: ServerSlot;
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(slot === 'admin' ? getAdminBase() : getApiBase());
  const [busy, setBusy] = useState(false);

  const current = slot === 'admin' ? getAdminBase() : getApiBase();
  const hint =
    slot === 'admin'
      ? 'Address of the machine running the admin console (port 3001)'
      : 'Backend address (LAN IP of the machine running the API, port 4100)';

  async function save() {
    setBusy(true);
    try {
      const ok = slot === 'admin' ? await probeWeb(draft) : await probeApi(draft);
      if (!ok) {
        Alert.alert(
          'Server not reachable',
          `No answer from ${normalizeBase(draft, slot)}${slot === 'admin' ? '/' : '/healthz'}.\n\nCheck that:\n• the platform is running (./start.sh)\n• this phone and the server are on the same network\n• the address uses the server's LAN IP, not localhost`,
        );
        return;
      }
      await setServerBase(draft, slot);
      setEditing(false);
      onChanged?.();
      Alert.alert('Connected', `Now using ${slot === 'admin' ? getAdminBase() : getApiBase()}`);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <View style={{ marginTop: spacing.md, alignItems: 'center' }}>
        <Text
          onPress={() => {
            setDraft(current);
            setEditing(true);
          }}
          style={{ ...type.caption, color: colors.mutedForeground, textAlign: 'center' }}
        >
          {slot === 'admin' ? 'Console' : 'Server'}: {current} ·{' '}
          <Text style={{ color: colors.primary }}>Change</Text>
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: spacing.md }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: 2 }}>
        {hint} — currently {slotLabel(slot)}
      </Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder={slot === 'admin' ? 'http://192.168.1.20:3001' : 'http://192.168.1.20:4100'}
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
