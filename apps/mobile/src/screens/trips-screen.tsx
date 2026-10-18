/**
 * My Trips (Phase 3 — offline-first). Reads the SQLite vault first so the
 * list renders instantly with zero network, then refreshes from the API in
 * the background. Each card links to check-in / baggage / rebooking.
 */
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookings } from '@/lib/hooks';
import { listBookings, type VaultBooking } from '@/lib/vault';
import { Badge, Card, EmptyState, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function SmallAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        ...type.caption,
        color: colors.primary,
        backgroundColor: colors.secondary,
        borderRadius: 6,
        paddingHorizontal: spacing.sm,
        paddingVertical: spacing.xs,
      }}
    >
      {label}
    </Text>
  );
}

export function TripsScreen() {
  const nav = useNavigation<Nav>();
  const [offline, setOffline] = useState<VaultBooking[]>([]);
  const { data: live, isLoading, isRefetching, refetch } = useBookings();

  // Offline vault first — instant paint, no spinner.
  useFocusEffect(
    useCallback(() => {
      void listBookings()
        .then(setOffline)
        .catch(() => undefined);
    }, []),
  );

  // Live API data wins; the vault covers airplane mode.
  const list: VaultBooking[] = (live ?? offline) as VaultBooking[];

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground, marginBottom: spacing.md }}>
        My Trips
      </Text>
      <FlatList
        data={list}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        ListEmptyComponent={
          isLoading ? null : (
            <EmptyState title="Nothing here yet" body="Booked trips appear here — online or off." />
          )
        }
        renderItem={({ item }) => (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ ...type.title, color: colors.foreground }}>
                {item.originCode} → {item.destinationCode}
              </Text>
              <Badge
                label={item.status}
                tone={item.status === 'CONFIRMED' ? 'success' : 'warning'}
              />
            </View>
            <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
              {item.flightNumber} ·{' '}
              {item.departUtc ? new Date(item.departUtc).toLocaleString() : '—'}
            </Text>
            <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: 2 }}>
              PNR {item.pnr}
            </Text>
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                gap: spacing.sm,
                marginTop: spacing.sm,
              }}
            >
              {item.status === 'CONFIRMED' && (
                <SmallAction
                  label="Check in"
                  onPress={() => nav.navigate('CheckIn', { bookingId: item.id })}
                />
              )}
              <SmallAction
                label="Baggage"
                onPress={() => nav.navigate('Baggage', { bookingId: item.id })}
              />
              <SmallAction
                label="Rebook"
                onPress={() => nav.navigate('Rebook', { bookingId: item.id, flightId: '' })}
              />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
