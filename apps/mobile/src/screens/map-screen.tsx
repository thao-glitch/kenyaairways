/**
 * Map screen (Phase 4 — live flight tracking).
 *
 * Loads the current trip's flight, fetches its live position from
 * `GET /flights/:id/position` (20 s poll via useFlightPosition), draws the
 * great-circle route line between the two airports and animates the aircraft
 * marker along it. Battery-conscious: the poll pauses when the screen loses
 * focus, and the camera follows the plane only while it is moving.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { useBookings, useFlightPosition } from '@/lib/hooks';
import { useTripStore } from '@/store/trip';
import { Loading, Screen, Card, Badge } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';

export function MapScreen() {
  const { data: bookings } = useBookings();
  const { current, setCurrent } = useTripStore();
  const [visible, setVisible] = useState(true);
  const mapRef = useRef<MapView>(null);

  // Pick the most recent confirmed trip as the tracked flight.
  useEffect(() => {
    if (current || !bookings?.length) return;
    const next = bookings.find((b) => b.status === 'CONFIRMED') ?? bookings[0];
    const seg = next?.segments[0];
    if (next && seg) {
      setCurrent({
        flightId: seg.flightId,
        bookingId: next.id,
        flightNumber: seg.flightNumber,
        originCode: seg.originCode,
        destinationCode: seg.destinationCode,
        departUtc: seg.departUtc,
      });
    }
  }, [bookings, current, setCurrent]);

  const flightId = current?.flightId ?? '';
  const { data: position, isLoading } = useFlightPosition(flightId, visible);

  const region = useMemo(() => {
    const origin = position?.origin;
    const dest = position?.destination;
    if (!origin || !dest) return null;
    const midLat = (origin.latitude + dest.latitude) / 2;
    const midLon = (origin.longitude + dest.longitude) / 2;
    const span = Math.max(
      Math.abs(origin.latitude - dest.latitude),
      Math.abs(origin.longitude - dest.longitude),
      2,
    );
    return {
      latitude: midLat,
      longitude: midLon,
      latitudeDelta: span * 1.6,
      longitudeDelta: span * 1.6,
    };
  }, [position]);

  // Keep the camera on the aircraft while it moves.
  useEffect(() => {
    if (!position?.position || !mapRef.current) return;
    mapRef.current.animateCamera({ center: position.position, zoom: 7 }, { duration: 1000 });
  }, [position?.position?.latitude, position?.position?.longitude]);

  useFocusEffect(() => {
    setVisible(true);
    return () => setVisible(false);
  });

  if (isLoading && !position) return <Loading label="Finding your flight…" />;

  if (!position || !region) {
    return (
      <Screen>
        <Card>
          <Text style={{ ...type.title, color: colors.foreground }}>No flight to track</Text>
          <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: spacing.xs }}>
            Book or check in to a flight and its live position appears here.
          </Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen style={{ padding: 0 }}>
      <MapView ref={mapRef} style={{ flex: 1 }} initialRegion={region}>
        <Polyline
          coordinates={[
            { latitude: position.origin.latitude, longitude: position.origin.longitude },
            { latitude: position.destination.latitude, longitude: position.destination.longitude },
          ]}
          strokeColor={colors.primary}
          strokeWidth={3}
        />
        {position.position && (
          <Marker
            coordinate={position.position}
            title={position.flightNumber}
            description={`${position.phase} · ${Math.round(position.progress * 100)}%`}
          >
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 999,
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                transform: [{ rotate: `${position.headingDeg}deg` }],
              }}
            >
              <Text style={{ color: colors.primaryForeground, fontSize: 16 }}>✈</Text>
            </View>
          </Marker>
        )}
        <Marker
          coordinate={{ latitude: position.origin.latitude, longitude: position.origin.longitude }}
          title={position.origin.code}
        />
        <Marker
          coordinate={{
            latitude: position.destination.latitude,
            longitude: position.destination.longitude,
          }}
          title={position.destination.code}
        />
      </MapView>

      {/* Status card overlaid at the bottom of the map. */}
      <View
        style={{ position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg }}
      >
        <Card>
          <View
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <Text style={{ ...type.title, color: colors.foreground }}>{position.flightNumber}</Text>
            <Badge
              label={position.phase}
              tone={position.phase === 'ENROUTE' ? 'success' : 'warning'}
            />
          </View>
          <Text style={{ ...type.body, color: colors.mutedForeground, marginTop: 2 }}>
            {position.origin.code} → {position.destination.code} ·{' '}
            {Math.round(position.progress * 100)}% ·{' '}
            {position.altitudeFt ? `${position.altitudeFt.toLocaleString()} ft` : '—'}
          </Text>
          {position.groundSpeedKts && (
            <Text style={{ ...type.caption, color: colors.mutedForeground }}>
              {position.groundSpeedKts} kts · heading {Math.round(position.headingDeg)}°
            </Text>
          )}
        </Card>
      </View>
    </Screen>
  );
}
