/**
 * Home dashboard (Phase 2) — the upcoming trip is the hero. Below it:
 * quick actions (search, check-in) and a compact status strip. Data comes
 * from `useBookings` which mirrors into the SQLite vault, so a signed-in
 * user always sees their next trip even on a cold, offline launch.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookings } from '@/lib/hooks';
import { getBackendMode, subscribeBackendMode, type BackendMode } from '@/offline/connectivity';
import { Badge, Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAYABLE = new Set(['HELD', 'PENDING_PAYMENT']);

/** Shown while the PC backend is unreachable — the device answers instead. */
function OfflineBanner() {
  const [mode, setMode] = useState<BackendMode>(getBackendMode());
  useEffect(() => subscribeBackendMode(setMode), []);
  if (mode !== 'local') return null;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: spacing.sm,
        marginBottom: spacing.md,
      }}
    >
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>
        Offline mode — search, booking, check-in and boarding passes run on this device.
      </Text>
    </View>
  );
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const { data: bookings, isLoading } = useBookings();

  if (isLoading) return <Loading label="Loading your trips…" />;

  const upcoming = (bookings ?? [])
    .filter((b) => !['CANCELLED', 'COMPLETED'].includes(b.status))
    .sort((a, b) =>
      (a.segments[0]?.departUtc ?? '').localeCompare(b.segments[0]?.departUtc ?? ''),
    )[0];

  const seg = upcoming?.segments[0];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <OfflineBanner />
        <Text style={{ ...type.hero, color: colors.foreground, marginBottom: spacing.md }}>
          Karibu 👋
        </Text>

        {upcoming && seg ? (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>Next trip</Text>
              <Badge
                label={upcoming.status}
                tone={PAYABLE.has(upcoming.status) ? 'warning' : 'success'}
              />
            </View>
            <Text style={{ ...type.hero, color: colors.foreground, marginTop: spacing.xs }}>
              {seg.originCode} → {seg.destinationCode}
            </Text>
            <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
              {seg.flightNumber} · {new Date(seg.departLocal).toLocaleString()}
            </Text>
            <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: 2 }}>
              PNR {upcoming.pnr}
            </Text>

            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <View style={{ flex: 1 }}>
                {PAYABLE.has(upcoming.status) ? (
                  <Button
                    title="Pay now"
                    onPress={() => nav.navigate('Payment', { bookingId: upcoming.id })}
                  />
                ) : (
                  <Button
                    title="View trip"
                    onPress={() => nav.navigate('FlightDetail', { flightId: seg.flightId })}
                  />
                )}
              </View>
              {upcoming.status === 'CONFIRMED' && (
                <View style={{ flex: 1 }}>
                  <Button
                    title="Check in"
                    variant="secondary"
                    onPress={() => nav.navigate('CheckIn', { bookingId: upcoming.id })}
                  />
                </View>
              )}
            </View>

            {PAYABLE.has(upcoming.status) && (
              <>
                <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.sm }}>
                  Payment due — pay by M-Pesa to confirm your seat.
                </Text>
                <View style={{ marginTop: spacing.sm }}>
                  <Button
                    title="View trip"
                    variant="ghost"
                    onPress={() => nav.navigate('FlightDetail', { flightId: seg.flightId })}
                  />
                </View>
              </>
            )}
          </Card>
        ) : (
          <Card>
            <EmptyState
              title="No trips yet"
              body="Search a route to book your first Kenya Airways flight."
            />
          </Card>
        )}

        <Text
          style={{
            ...type.title,
            color: colors.foreground,
            marginTop: spacing.md,
            marginBottom: spacing.sm,
          }}
        >
          Quick actions
        </Text>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button title="Search flights" onPress={() => nav.navigate('Search')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="My trips"
              variant="secondary"
              onPress={() => nav.navigate('Main', {} as never)}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
