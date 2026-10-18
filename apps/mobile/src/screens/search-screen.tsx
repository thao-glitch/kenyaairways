/**
 * Search — pick origin, destination and date; results push to FlightDetail.
 * Uses the airports directory for pickers and the flight-search endpoint.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAirports, useFlightSearch } from '@/lib/hooks';
import { Badge, Button, Card, EmptyState, Screen } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';
import type { RootStackParamList } from '@/navigation/root-navigator';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const today = new Date().toISOString().slice(0, 10);

export function SearchScreen() {
  const nav = useNavigation<Nav>();
  const { data: airports } = useAirports();
  const [origin, setOrigin] = useState('NBO');
  const [destination, setDestination] = useState('');
  const [date, setDate] = useState(today);
  const [adults, setAdults] = useState(1);
  const [submitted, setSubmitted] = useState(false);

  const query = useMemo(
    () => ({ origin, destination, date, adults }),
    [origin, destination, date, adults],
  );
  const { data: results, isFetching } = useFlightSearch(query, submitted && !!destination);

  return (
    <Screen>
      <Text style={{ ...type.hero, color: colors.foreground, marginBottom: spacing.md }}>
        Search flights
      </Text>

      <Card>
        <PickerRow
          label="From"
          value={origin}
          onChange={setOrigin}
          options={(airports ?? []).map((a) => `${a.code} — ${a.city}`)}
        />
        <PickerRow
          label="To"
          value={destination}
          onChange={setDestination}
          options={(airports ?? []).map((a) => `${a.code} — ${a.city}`)}
        />
        <View style={{ marginBottom: spacing.sm }}>
          <Text style={{ ...type.caption, color: colors.mutedForeground }}>Date (YYYY-MM-DD)</Text>
          <TextInput
            value={date}
            onChangeText={setDate}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 6,
              paddingHorizontal: spacing.sm,
              paddingVertical: spacing.sm,
              color: colors.foreground,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <Text style={{ ...type.body, color: colors.foreground }}>Adults</Text>
          <Pressable onPress={() => setAdults(Math.max(1, adults - 1))}>
            <Text style={{ ...type.title, color: colors.primary }}>−</Text>
          </Pressable>
          <Text style={{ ...type.title, color: colors.foreground }}>{adults}</Text>
          <Pressable onPress={() => setAdults(Math.min(9, adults + 1))}>
            <Text style={{ ...type.title, color: colors.primary }}>+</Text>
          </Pressable>
        </View>
        <View style={{ marginTop: spacing.md }}>
          <Button
            title={isFetching ? 'Searching…' : 'Search'}
            onPress={() => setSubmitted(true)}
            disabled={!destination}
            loading={isFetching}
          />
        </View>
      </Card>

      {submitted && results && results.results.length === 0 && (
        <EmptyState title="No flights" body="Try different airports or dates." />
      )}

      <FlatList
        data={results?.results ?? []}
        keyExtractor={(item) => item.flightId}
        renderItem={({ item }) => (
          <Pressable onPress={() => nav.navigate('FlightDetail', { flightId: item.flightId })}>
            <Card>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ ...type.title, color: colors.foreground }}>
                  {item.origin.code} → {item.destination.code}
                </Text>
                <Badge
                  label={item.status}
                  tone={item.status === 'SCHEDULED' ? 'success' : 'warning'}
                />
              </View>
              <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
                {item.flightNumber} · dep {item.departLocal} · arr {item.arriveLocal}
              </Text>
              <Text style={{ ...type.caption, color: colors.mutedForeground }}>
                From{' '}
                {Math.min(
                  ...item.fareOptions.map((f) => f.pricing.totalMinor / 100),
                ).toLocaleString()}{' '}
                {item.fareOptions[0]?.pricing.currency}
              </Text>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function PickerRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <Text style={{ ...type.caption, color: colors.mutedForeground }}>{label}</Text>
      <FlatList
        horizontal
        data={options}
        keyExtractor={(o) => o}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => {
          const code = item.slice(0, 3);
          const active = value === code;
          return (
            <Pressable
              onPress={() => onChange(code)}
              style={{
                backgroundColor: active ? colors.primary : colors.secondary,
                borderRadius: 6,
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                marginRight: spacing.xs,
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  color: active ? colors.primaryForeground : colors.foreground,
                }}
              >
                {item}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
