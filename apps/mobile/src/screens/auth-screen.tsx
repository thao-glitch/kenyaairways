/**
 * Auth screen — sign in / sign up. Posts `X-Client: mobile` so the API
 * returns bearer tokens in the body; they are persisted to the Keychain by
 * the session store. Errors render inline; loading disables the form.
 */
import { useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { useSessionStore } from '@/store/session';
import { api, ApiError } from '@/lib/api';
import type { MobileSessionDto } from '@kenyaairways/shared';
import { Button, Card, Screen } from '@/components/ui';
import { ServerSettings } from '@/components/server-settings';
import { colors, spacing, type } from '@/theme/tokens';

export function AuthScreen() {
  const setSession = useSessionStore((s) => s.setSession);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const path = mode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register';
      const body =
        mode === 'login'
          ? { identifier, password }
          : { phone, password, firstName, lastName, acceptTerms: true };
      const res = await api.post<{ user: unknown; session?: MobileSessionDto }>(path, body);
      if (res.session) {
        await setSession(res.session);
      } else {
        Alert.alert('Unexpected', 'No session returned — check API version.');
      }
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ marginTop: spacing.xl, marginBottom: spacing.lg }}>
        <Text style={{ ...type.hero, color: colors.foreground }}>Kenya Airways</Text>
        <Text style={{ ...type.body, color: colors.mutedForeground }}>
          Flights across the world
        </Text>
      </View>
      <Card>
        <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.sm }}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Text>
        {mode === 'register' && (
          <>
            <Field label="First name" value={firstName} onChange={setFirstName} />
            <Field label="Last name" value={lastName} onChange={setLastName} />
            <Field label="Phone (+254…)" value={phone} onChange={setPhone} />
          </>
        )}
        {mode === 'login' && (
          <Field label="Email or phone" value={identifier} onChange={setIdentifier} />
        )}
        <Field label="Password" value={password} onChange={setPassword} secure />
        <Button
          title={mode === 'login' ? 'Sign in' : 'Sign up'}
          onPress={() => void submit()}
          loading={busy}
          disabled={!password || (mode === 'login' ? !identifier : !firstName || !phone)}
        />
        <Text
          onPress={() => setMode(mode === 'login' ? 'register' : 'login')}
          style={{
            ...type.body,
            color: colors.primary,
            textAlign: 'center',
            marginTop: spacing.md,
          }}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </Text>
      </Card>
      <ServerSettings />
    </Screen>
  );
}

function Field({
  label,
  value,
  onChange,
  secure,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secure?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: 2 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
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
    </View>
  );
}
