/**
 * Home dashboard (Phase 2) — the upcoming trip is the hero. Below it:
 * quick actions (search, check-in) and a compact status strip. Data comes
 * from `useBookings` which mirrors into the SQLite vault, so a signed-in
 * user always sees their next trip even on a cold, offline launch.
 */
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBookings } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const PAYABLE = new Set(['HELD', 'PENDING_PAYMENT']);

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
                <Button
                  title="View trip"
                  onPress={() => nav.navigate('FlightDetail', { flightId: seg.flightId })}
                />
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
              <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.sm }}>
                Payment due — open the trip to pay by M-Pesa.
              </Text>
            )}
          </Card>
        ) : (
          <Card>
            <EmptyState
              title="No trips yet"
              body="Search a route to book your first Flight13 flight."
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
