/**
 * Admin APK offline tools — a native staff console for the on-device world.
 *
 * The WebView console needs the PC; these screens don't. They talk straight
 * to the local engine (dispatchLocal) with the same paths, DTOs and role
 * gates the server enforces, so a store manager can pull up bookings, verify
 * an M-Pesa SMS, move a fare or edit the site name with no backend in the
 * building.
 *
 * Structure:
 *   OfflineToolsScreen  — staff login gate + tab shell + language toggle
 *   (tabs delegate to OverviewTab / FlightsTab / BookingsTab /
 *    PaymentsTab / SettingsTab in offline-tools-tabs.tsx)
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { SessionUserDto } from '@kenyaairways/shared';
import { dispatchLocal } from '@/offline/dispatch';
import { isLocal } from '@/offline/connectivity';
import { Button, Card } from '@/components/ui';
import { colors, radii, spacing, type } from '@/theme/tokens';
import { t, type AdminLocale, type AdminMessageKey } from './messages';
import {
  BookingsTab,
  FlightsTab,
  OverviewTab,
  PaymentsTab,
  SettingsTab,
  type LocalCall,
} from './offline-tools-tabs';

type TabKey = 'overview' | 'flights' | 'bookings' | 'payments' | 'settings';

const TAB_ORDER: TabKey[] = ['overview', 'flights', 'bookings', 'payments', 'settings'];

/** Everything the tabs need: translate + a tokenised local call helper. */
export interface ToolsEnv {
  locale: AdminLocale;
  t: (key: AdminMessageKey, vars?: Record<string, string>) => string;
  call: LocalCall;
  user: SessionUserDto;
}

export function OfflineToolsScreen() {
  const [locale, setLocale] = useState<AdminLocale>('en');
  const [user, setUser] = useState<SessionUserDto | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('overview');

  const tr = useCallback(
    (key: AdminMessageKey, vars?: Record<string, string>) => t(locale, key, vars),
    [locale],
  );

  const call = useCallback<LocalCall>(
    (method, path, opts) => {
      const res = dispatchLocal({
        method,
        path,
        query: opts?.query,
        body: opts?.body,
        authorization: token ? `Bearer ${token}` : null,
      });
      if (res.status >= 400) {
        const err = (res.body as { error?: { code?: string; message?: string } })?.error;
        throw new Error(err?.message ?? `Local call failed (${res.status})`);
      }
      return res.body as never;
    },
    [token],
  );

  const env = useMemo<ToolsEnv | null>(
    () => (user && token ? { locale, t: tr, call, user } : null),
    [user, token, locale, tr, call],
  );

  const toggleLocale = () => setLocale((l) => (l === 'en' ? 'sw' : 'en'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View>
          <Text style={{ ...type.title, color: colors.foreground }}>{tr('offlineTools')}</Text>
          <Text style={{ ...type.caption, color: colors.mutedForeground }}>
            {isLocal() ? tr('offline') : tr('online')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          {user ? (
            <Pressable
              onPress={() => {
                setUser(null);
                setToken(null);
              }}
            >
              <Text style={{ ...type.caption, color: colors.primary, fontWeight: '600' }}>
                {tr('signOut')}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggleLocale}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radii.sm,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.xs,
            }}
          >
            <Text style={{ ...type.caption, color: colors.foreground, fontWeight: '600' }}>
              {locale === 'en' ? 'EN' : 'SW'}
            </Text>
          </Pressable>
        </View>
      </View>

      {!env ? (
        <LoginGate
          t={tr}
          onSignedIn={(u, tok) => {
            setUser(u);
            setToken(tok);
          }}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ maxHeight: 44 }}
            contentContainerStyle={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              gap: spacing.sm,
            }}
          >
            {TAB_ORDER.map((key) => (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={{
                  paddingHorizontal: spacing.md,
                  paddingVertical: spacing.xs,
                  borderRadius: radii.sm,
                  backgroundColor: tab === key ? colors.primary : colors.secondary,
                }}
              >
                <Text
                  style={{
                    ...type.caption,
                    fontWeight: '600',
                    color: tab === key ? colors.primaryForeground : colors.foreground,
                  }}
                >
                  {tr(key)}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
          >
            {tab === 'overview' ? <OverviewTab env={env} /> : null}
            {tab === 'flights' ? <FlightsTab env={env} /> : null}
            {tab === 'bookings' ? <BookingsTab env={env} /> : null}
            {tab === 'payments' ? <PaymentsTab env={env} /> : null}
            {tab === 'settings' ? <SettingsTab env={env} /> : null}
          </ScrollView>
        </>
      )}
    </SafeAreaView>
  );
}

// ── staff login gate ────────────────────────────────────────────────────────

function LoginGate({
  t: tr,
  onSignedIn,
}: {
  t: (key: AdminMessageKey, vars?: Record<string, string>) => string;
  onSignedIn: (user: SessionUserDto, token: string) => void;
}) {
  const [identifier, setIdentifier] = useState('admin@kenyaairways.example');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const res = dispatchLocal({
        method: 'POST',
        path: '/api/v1/auth/login',
        body: { identifier: identifier.trim(), password },
      });
      if (res.status >= 400) {
        const err = (res.body as { error?: { message?: string } })?.error;
        throw new Error(err?.message ?? tr('loginFailed'));
      }
      const body = res.body as { user: SessionUserDto; session?: { accessToken: string } };
      if (!body.session?.accessToken) throw new Error(tr('loginFailed'));
      onSignedIn(body.user, body.session.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('loginFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, justifyContent: 'center', padding: spacing.lg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Card>
        <Text style={{ ...type.title, color: colors.foreground, marginBottom: spacing.xs }}>
          {tr('staffLogin')}
        </Text>
        <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.md }}>
          {tr('loginHint')}
        </Text>
        <Text style={{ ...type.caption, color: colors.mutedForeground }}>{tr('identifier')}</Text>
        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.sm,
            padding: spacing.sm,
            marginBottom: spacing.sm,
            color: colors.foreground,
            backgroundColor: colors.card,
          }}
        />
        <Text style={{ ...type.caption, color: colors.mutedForeground }}>{tr('password')}</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radii.sm,
            padding: spacing.sm,
            marginBottom: spacing.md,
            color: colors.foreground,
            backgroundColor: colors.card,
          }}
        />
        {error ? (
          <Text style={{ ...type.caption, color: colors.destructive, marginBottom: spacing.sm }}>
            {error}
          </Text>
        ) : null}
        <Button title={tr('signIn')} onPress={() => void signIn()} loading={busy} />
        {busy ? (
          <ActivityIndicator style={{ marginTop: spacing.sm }} color={colors.primary} />
        ) : null}
      </Card>
    </KeyboardAvoidingView>
  );
}
