/**
 * Smart rebooking (Must-have #4) — search alternate flights on the same
 * route/date and one-tap rebook. Creates a new booking on the chosen
 * flight; the old booking is cancelled (which the API handles — refunds
 * route through the existing FINANCE-gated refund flow).
 */
import { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBooking, useFlight, useFlightSearch } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import type { BookingDto } from '@flight13/shared';
import { Badge, Button, Card, EmptyState, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'Rebook'>;

export function RebookScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { data: booking, isLoading: bookingLoading } = useBooking(params.bookingId);
  const { data: currentFlight } = useFlight(
    params.flightId || booking?.segments[0]?.flightId || '',
  );

  const seg = booking?.segments[0];
  const origin = seg?.originCode ?? '';
  const destination = seg?.destinationCode ?? '';
  const date = seg ? new Date(seg.departUtc).toISOString().slice(0, 10) : '';

  const { data: alternatives, isLoading } = useFlightSearch(
    { origin, destination, date, adults: 1 },
    !!origin && !!destination && !!date,
  );

  const [busyId, setBusyId] = useState<string | null>(null);

  const options = (alternatives?.results ?? []).filter(
    (f) => f.flightId !== (currentFlight?.flightId ?? seg?.flightId),
  );

  async function rebook(flightId: string, fareClassCode: string) {
    if (!booking) return;
    setBusyId(flightId);
    try {
      // 1. Create the replacement booking.
      const replacement = await api.post<BookingDto>('/api/v1/bookings', {
        segments: [{ flightId, fareClassCode }],
        passengers: booking.passengers.map((p) => ({ type: p.type })),
        adults: booking.adultCount,
      });
      // 2. Cancel the old booking (releases inventory; refund if paid).
      await api.post(`/api/v1/bookings/${booking.id}/cancel`, {
        reason: 'REBOOKED',
      });
      Alert.alert(
        'Rebooked',
        `New booking ${replacement.pnr} confirmed. Any refund for the old booking is processed by our finance team.`,
      );
      nav.popToTop();
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Rebooking failed');
    } finally {
      setBusyId(null);
    }
  }

  if (bookingLoading || isLoading) return <Loading label="Finding alternates…" />;

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground }}>Rebook</Text>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.md }}>
        {origin} → {destination} · {date}
      </Text>

      {options.length === 0 ? (
        <EmptyState
          title="No alternate flights"
          body="There are no other flights on this route today."
        />
      ) : (
        <FlatList
          data={options}
          keyExtractor={(f) => f.flightId}
          renderItem={({ item }) => (
            <Card>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...type.title, color: colors.foreground }}>{item.flightNumber}</Text>
                <Badge
                  label={item.status}
                  tone={item.status === 'SCHEDULED' ? 'success' : 'warning'}
                />
              </View>
              <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
                dep {item.departLocal} · arr {item.arriveLocal}
              </Text>
              <View style={{ marginTop: spacing.sm }}>
                <FlatList
                  horizontal
                  data={item.fareOptions}
                  keyExtractor={(f) => f.fareClass.code}
                  renderItem={({ item: fare }) => (
                    <Pressable
                      onPress={() => void rebook(item.flightId, fare.fareClass.code)}
                      disabled={busyId !== null}
                      style={{
                        backgroundColor: colors.primary,
                        borderRadius: 6,
                        paddingHorizontal: spacing.md,
                        paddingVertical: spacing.sm,
                        marginRight: spacing.sm,
                      }}
                    >
                      <Text
                        style={{
                          ...type.caption,
                          color: colors.primaryForeground,
                          fontWeight: '600',
                        }}
                      >
                        {(fare.pricing.totalMinor / 100).toLocaleString()} {fare.pricing.currency} ·{' '}
                        {fare.fareClass.name}
                      </Text>
                    </Pressable>
                  )}
                />
              </View>
            </Card>
          )}
        />
      )}

      <Button title="Back" variant="ghost" onPress={() => nav.goBack()} />
    </Screen>
  );
}
