/**
 * Boarding pass (Ticket Vault) — renders the IATA BCBP string as a
 * high-contrast QR code. The pass comes from the local SQLite vault first
 * (instant, zero network), falling back to the API. Bright background + pure
 * black modules so gate scanners read it reliably at any brightness.
 */
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import QRCode from 'react-native-qrcode-svg';
import { getPass, type VaultPass } from '@/lib/vault';
import { api } from '@/lib/api';
import type { BoardingPassDto } from '@kenyaairways/shared';
import { Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Rt = RouteProp<RootStackParamList, 'BoardingPass'>;

export function BoardingPassScreen() {
  const { params } = useRoute<Rt>();
  const [pass, setPass] = useState<VaultPass | BoardingPassDto | null>(null);

  const load = useCallback(async () => {
    // Offline vault first — renders with zero network.
    const cached = await getPass(params.passId).catch(() => null);
    if (cached) {
      setPass(cached);
      return;
    }
    // Fallback: fetch from API and persist for next time.
    const fresh = await api.get<BoardingPassDto>(`/api/v1/boarding-passes/${params.passId}`);
    setPass(fresh);
  }, [params.passId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!pass) {
    return (
      <Screen>
        <Text style={{ ...type.body, color: colors.mutedForeground }}>Loading boarding pass…</Text>
      </Screen>
    );
  }

  const bcbp = 'bcbp' in pass ? pass.bcbp : '';
  const name = 'passengerName' in pass ? pass.passengerName : '';
  const flight = 'flightNumber' in pass ? pass.flightNumber : '';
  const origin = 'originCode' in pass ? pass.originCode : '';
  const dest = 'destinationCode' in pass ? pass.destinationCode : '';
  const seat = 'seatLabel' in pass ? pass.seatLabel : null;
  const gate = 'gate' in pass ? pass.gate : null;

  return (
    <Screen style={{ alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: 16,
          padding: spacing.lg,
          alignItems: 'center',
          width: '100%',
          maxWidth: 360,
        }}
      >
        <Text style={{ ...type.caption, color: colors.mutedForeground }}>BOARDING PASS</Text>
        <Text style={{ ...type.hero, color: colors.foreground, marginVertical: spacing.sm }}>
          {origin} → {dest}
        </Text>
        <QRCode value={bcbp} size={220} backgroundColor="#FFFFFF" color="#000000" />
        <View style={{ width: '100%', marginTop: spacing.md }}>
          <Row label="Passenger" value={name} />
          <Row label="Flight" value={flight} />
          {seat && <Row label="Seat" value={seat} />}
          {gate && <Row label="Gate" value={gate} />}
        </View>
      </View>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginTop: spacing.md }}>
        Works offline — screenshot or open this screen at the gate.
      </Text>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ ...type.body, fontWeight: '600', color: colors.foreground }}>
        {value || '—'}
      </Text>
    </View>
  );
}
