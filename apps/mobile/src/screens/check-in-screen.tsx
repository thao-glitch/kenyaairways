/**
 * Check-in — `POST /check-in` for all passengers on a booking, then routes
 * to the boarding-pass screen so the QR is front-and-centre for gate staff.
 */
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBooking } from '@/lib/hooks';
import { api, ApiError } from '@/lib/api';
import type { CheckInResultDto } from '@flight13/shared';
import { Button, Card, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'CheckIn'>;

export function CheckInScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Rt>();
  const { data: booking, isLoading } = useBooking(params.bookingId);
  const [busy, setBusy] = useState(false);

  if (isLoading || !booking) return <Loading label="Loading booking…" />;

  async function checkIn() {
    setBusy(true);
    try {
      const result = await api.post<CheckInResultDto>('/api/v1/check-in', {
        bookingId: params.bookingId,
      });
      const passId = result.checkIns[0]?.boardingPassId;
      if (passId) {
        nav.navigate('BoardingPass', { passId });
      } else {
        Alert.alert('Checked in', 'You are checked in. Boarding passes are in My Trips.');
        nav.goBack();
      }
    } catch (err) {
      Alert.alert('Error', err instanceof ApiError ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground }}>Check in</Text>
      <Card>
        <Text style={{ ...type.title, color: colors.foreground }}>
          {booking.segments[0]?.originCode} → {booking.segments[0]?.destinationCode}
        </Text>
        <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
          PNR {booking.pnr} · {booking.passengers.length} passenger
          {booking.passengers.length > 1 ? 's' : ''}
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <Button title="Check in now" onPress={() => void checkIn()} loading={busy} />
        </View>
      </Card>
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>
        Checked-in passengers get a high-contrast QR boarding pass that works offline.
      </Text>
    </Screen>
  );
}
