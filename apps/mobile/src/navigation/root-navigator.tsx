/**
 * Root navigator — auth stack when signed out, bottom tabs when signed in.
 *
 * Tabs: Home (upcoming trip dashboard) · My Trips (offline vault) ·
 * Map (live tracker) · Profile. Stack screens cover the flows that push on
 * top: search, flight detail, seat preview, check-in, boarding pass,
 * baggage tracking and smart rebooking.
 */
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, ActivityIndicator, View } from 'react-native';
import { AuthScreen } from '@/screens/auth-screen';
import { HomeScreen } from '@/screens/home-screen';
import { TripsScreen } from '@/screens/trips-screen';
import { MapScreen } from '@/screens/map-screen';
import { ProfileScreen } from '@/screens/profile-screen';
import { SearchScreen } from '@/screens/search-screen';
import { FlightDetailScreen } from '@/screens/flight-detail-screen';
import { SeatPreviewScreen } from '@/screens/seat-preview-screen';
import { CheckInScreen } from '@/screens/check-in-screen';
import { BoardingPassScreen } from '@/screens/boarding-pass-screen';
import { BaggageScreen } from '@/screens/baggage-screen';
import { RebookScreen } from '@/screens/rebook-screen';
import { PaymentScreen } from '@/screens/payment-screen';
import { useSessionStore } from '@/store/session';
import { colors } from '@/theme/tokens';

export type MainTabsParamList = {
  Home: undefined;
  Trips: undefined;
  Map: { flightId?: string } | undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  Main: undefined;
  Search: undefined;
  FlightDetail: { flightId: string };
  SeatPreview: { flightId: string; bookingId?: string };
  Payment: { bookingId: string; flightId?: string };
  CheckIn: { bookingId: string };
  BoardingPass: { passId: string };
  Baggage: { bookingId: string };
  Rebook: { bookingId: string; flightId: string };
};

const Tab = createBottomTabNavigator<MainTabsParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

const tabIcon = (glyph: string) =>
  function TabIcon({ color }: { color: string }) {
    return (
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 18, color }}>{glyph}</Text>
      </View>
    );
  };

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarIcon: tabIcon('⌂'), tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="Trips"
        component={TripsScreen}
        options={{ tabBarIcon: tabIcon('✈'), tabBarLabel: 'My Trips' }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarIcon: tabIcon('◉'), tabBarLabel: 'Map' }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: tabIcon('☺'), tabBarLabel: 'Profile' }}
      />
    </Tab.Navigator>
  );
}

export function RootNavigator({ signedIn }: { signedIn: boolean }) {
  const status = useSessionStore((s) => s.status);
  if (status === 'unknown') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!signedIn ? (
        <Stack.Screen name="Auth" component={AuthScreen} />
      ) : (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="FlightDetail" component={FlightDetailScreen} />
          <Stack.Screen name="SeatPreview" component={SeatPreviewScreen} />
          <Stack.Screen name="Payment" component={PaymentScreen} />
          <Stack.Screen name="CheckIn" component={CheckInScreen} />
          <Stack.Screen name="BoardingPass" component={BoardingPassScreen} />
          <Stack.Screen name="Baggage" component={BaggageScreen} />
          <Stack.Screen name="Rebook" component={RebookScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
