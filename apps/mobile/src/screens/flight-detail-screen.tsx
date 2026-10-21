/**
 * Flight detail — schedule, fare families, and entry points to seat preview
 * and booking. Each fare option creates a booking (`POST /bookings`).
 */
import { useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFlight, useMe } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import type { BookingDto } from '@kenyaairways/shared';
import { Badge, Button, Card, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'FlightDetail'>;

export function FlightDetailScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { data: flight, isLoading } = useFlight(params.flightId);
  const { data: me } = useMe();
  const [busy, setBusy] = useState(false);

  if (isLoading || !flight) return <Loading label="Loading flight…" />;

  async function book(fareClassCode: string) {
    setBusy(true);
    try {
      const booking = await api.post<BookingDto>('/api/v1/bookings', {
        tripType: 'ONE_WAY',
        segments: [{ flightId: params.flightId, fareClassCode }],
        passengers: [
          {
            type: 'ADULT',
            firstName: me?.firstName ?? 'Passenger',
            lastName: me?.lastName ?? 'Traveller',
            email: me?.email ?? undefined,
            phone: me?.phone ?? undefined,
          },
        ],
        contactEmail: me?.email ?? undefined,
        contactPhone: me?.phone ?? undefined,
      });
      nav.navigate('SeatPreview', { flightId: params.flightId, bookingId: booking.id });
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Could not create booking');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ ...type.hero, color: colors.foreground }}>
          {flight.origin.code} → {flight.destination.code}
        </Text>
        <Badge label={flight.status} tone={flight.status === 'SCHEDULED' ? 'success' : 'warning'} />
      </View>
      <Text style={{ ...type.body, color: colors.mutedForeground, marginBottom: spacing.md }}>
        {flight.flightNumber} · dep {flight.departLocal} · arr {flight.arriveLocal} ·{' '}
        {Math.round(flight.durationMinutes / 60)}h {flight.durationMinutes % 60}m
      </Text>

      <FlatList
        data={flight.fareOptions}
        keyExtractor={(f) => f.fareClass.code}
        ListHeaderComponent={
          <Button
            title="Preview seats"
            variant="secondary"
            onPress={() => nav.navigate('SeatPreview', { flightId: params.flightId })}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...type.title, color: colors.foreground }}>{item.fareClass.name}</Text>
              <Text style={{ ...type.title, color: colors.primary }}>
                {(item.pricing.totalMinor / 100).toLocaleString()} {item.pricing.currency}
              </Text>
            </View>
            <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: 2 }}>
              {item.fareClass.baggageKg} kg bag · {item.fareClass.carryOnKg} kg carry-on ·{' '}
              {item.fareClass.refundable ? 'Refundable' : 'Non-refundable'} · {item.seatsAvailable}{' '}
              seats left
            </Text>
            <View style={{ marginTop: spacing.sm }}>
              <Button
                title="Book"
                onPress={() => void book(item.fareClass.code)}
                loading={busy}
                disabled={item.seatsAvailable === 0}
              />
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}
