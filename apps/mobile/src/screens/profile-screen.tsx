/**
 * Profile — account info + sign out. Sign-out clears the secure-store
 * session, which flips the root navigator back to the auth stack.
 */
import { Alert, Text, View } from 'react-native';
import { useSessionStore } from '@/store/session';
import { useMe } from '@/lib/hooks';
import { clearVault } from '@/lib/vault';
import { Button, Card, Loading, Screen } from '@/components/ui';
import { ServerSettings } from '@/components/server-settings';
import { colors, spacing, type } from '@/theme/tokens';

export function ProfileScreen() {
  const { clearSession } = useSessionStore();
  const { data: me, isLoading } = useMe();

  if (isLoading) return <Loading />;

  async function signOut() {
    await clearVault().catch(() => undefined);
    await clearSession();
  }

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground, marginBottom: spacing.md }}>
        Profile
      </Text>
      <Card>
        <Text style={{ ...type.title, color: colors.foreground }}>
          {me ? `${me.firstName} ${me.lastName}` : 'Guest'}
        </Text>
        {me?.phone && (
          <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
            {me.phone}
          </Text>
        )}
        {me?.email && (
          <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
            {me.email}
          </Text>
        )}
        <View style={{ marginTop: spacing.md }}>
          <Button
            title="Sign out"
            variant="danger"
            onPress={() =>
              Alert.alert('Sign out?', 'You can sign back in anytime.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
              ])
            }
          />
        </View>
      </Card>
      <ServerSettings />
    </Screen>
  );
}
