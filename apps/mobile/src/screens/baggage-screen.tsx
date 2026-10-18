/**
 * Baggage tracking (Must-have #6) — a visual timeline of each bag's
 * journey: Accepted → Loaded → In transit → Landed → On the belt. Stages
 * are derived server-side from real check-in and flight status, never
 * invented. Polls every 60 s while visible.
 */
import { ScrollView, Text, View } from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import { useBaggage } from '@/lib/hooks';
import type { BaggageEventDto } from '@flight13/shared';
import { Card, EmptyState, Loading, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Rt = RouteProp<RootStackParamList, 'Baggage'>;

export function BaggageScreen() {
  const { params } = useRoute<Rt>();
  const { data, isLoading } = useBaggage(params.bookingId);

  if (isLoading) return <Loading label="Tracking your bags…" />;

  if (!data || data.items.length === 0) {
    return (
      <Screen>
        <EmptyState title="No bags found" body="Checked bags appear here after ticketing." />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground, marginBottom: spacing.sm }}>
        Baggage
      </Text>
      <Text style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.md }}>
        PNR {data.pnr}
      </Text>
      <ScrollView showsVerticalScrollIndicator={false}>
        {data.items.map((item) => (
          <Card key={item.ticketNumber}>
            <Text style={{ ...type.title, color: colors.foreground }}>{item.passengerName}</Text>
            <Text
              style={{ ...type.caption, color: colors.mutedForeground, marginBottom: spacing.sm }}
            >
              Tag {item.ticketNumber} · {item.weightKg} kg · {item.flightNumber}
            </Text>
            <Timeline events={item.events} />
          </Card>
        ))}
      </ScrollView>
    </Screen>
  );
}

function Timeline({ events }: { events: BaggageEventDto[] }) {
  return (
    <View>
      {events.map((event, i) => (
        <View key={event.code} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
          {/* Rail: dot + connector */}
          <View style={{ alignItems: 'center', width: 24 }}>
            <View
              style={{
                width: 14,
                height: 14,
                borderRadius: 7,
                backgroundColor: event.done ? colors.success : colors.border,
                marginTop: 2,
              }}
            />
            {i < events.length - 1 && (
              <View
                style={{
                  width: 2,
                  flex: 1,
                  minHeight: 24,
                  backgroundColor: events[i + 1].done ? colors.success : colors.border,
                }}
              />
            )}
          </View>
          {/* Label */}
          <View style={{ flex: 1, paddingBottom: spacing.sm }}>
            <Text
              style={{
                ...type.body,
                fontWeight: event.done ? '600' : '400',
                color: event.done ? colors.foreground : colors.mutedForeground,
              }}
            >
              {event.label}
            </Text>
            {event.at && (
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>
                {new Date(event.at).toLocaleString()}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
