/**
 * Seat preview (Must-have #5) — an interactive SVG-style cabin map built
 * from the live seat map. Seats are coloured by status (free / held / sold /
 * selected), grouped by zone, and tapping a free seat holds it
 * (`POST /bookings/:id/seats`). Amenities (zone, extra fee) shown per seat.
 */
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useSeatMap } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import type { SeatMapSeatDto } from '@flight13/shared';
import { Button, Card, Loading, Screen, Badge } from '@/components/ui';
import { colors, radii, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Rt = RouteProp<RootStackParamList, 'SeatPreview'>;

const seatColor = (seat: SeatMapSeatDto, selected: boolean): string => {
  if (selected) return colors.primary;
  switch (seat.status) {
    case 'AVAILABLE':
      return '#DCFCE7';
    case 'HELD':
      return '#FEF3C7';
    default:
      return '#E5E7EB';
  }
};

export function SeatPreviewScreen() {
  const { params } = useRoute<Rt>();
  const { data: seatMap, isLoading } = useSeatMap(params.flightId);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isLoading || !seatMap) return <Loading label="Loading cabin…" />;

  // Group seats by row for the cabin layout.
  const rows = new Map<number, SeatMapSeatDto[]>();
  for (const seat of seatMap.seats) {
    if (!rows.has(seat.row)) rows.set(seat.row, []);
    rows.get(seat.row)!.push(seat);
  }
  const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);

  async function hold() {
    if (!selected || !params.bookingId) return;
    setBusy(true);
    try {
      await api.post(`/api/v1/bookings/${params.bookingId}/seats`, { seatLabels: [selected] });
      Alert.alert('Seat held', `${selected} is held on your booking.`);
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Could not hold seat');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground }}>Seat preview</Text>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.sm }}>
        {seatMap.aircraftName ?? 'Aircraft'} · tap a green seat to select
      </Text>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {sortedRows.map(([rowNum, seats]) => (
          <View
            key={rowNum}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs }}
          >
            <Text style={{ ...type.caption, color: colors.mutedForeground, width: 28 }}>
              {rowNum}
            </Text>
            {seats
              .sort((a, b) => a.letter.localeCompare(b.letter))
              .map((seat) => {
                const isSelected = selected === seat.label;
                const free = seat.status === 'AVAILABLE';
                return (
                  <Pressable
                    key={seat.id}
                    disabled={!free}
                    onPress={() => setSelected(isSelected ? null : seat.label)}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radii.sm,
                      backgroundColor: seatColor(seat, isSelected),
                      borderWidth: 1,
                      borderColor: isSelected ? colors.primary : colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 4,
                    }}
                  >
                    <Text style={{ ...type.caption, color: colors.foreground, fontWeight: '600' }}>
                      {seat.letter}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
        ))}

        {selected && (
          <Card>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text style={{ ...type.title, color: colors.foreground }}>Seat {selected}</Text>
              {(() => {
                const seat = seatMap.seats.find((s) => s.label === selected);
                return seat ? (
                  <Badge
                    label={
                      seat.extraFeeMinor > 0
                        ? `+${(seat.extraFeeMinor / 100).toFixed(0)} ${seat.currency}`
                        : 'Free'
                    }
                    tone={seat.extraFeeMinor > 0 ? 'warning' : 'success'}
                  />
                ) : null;
              })()}
            </View>
            <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: 2 }}>
              Zone {seatMap.seats.find((s) => s.label === selected)?.zone} ·{' '}
              {seatMap.seats.find((s) => s.label === selected)?.cabin}
            </Text>
            {params.bookingId && (
              <View style={{ marginTop: spacing.sm }}>
                <Button title="Hold this seat" onPress={() => void hold()} loading={busy} />
              </View>
            )}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}
