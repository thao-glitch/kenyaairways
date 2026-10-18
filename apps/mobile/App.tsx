/**
 * Flight13 mobile — root component.
 *
 * Providers, outermost → innermost:
 *   SafeAreaProvider  — notch/status-bar insets on every screen
 *   QueryClientProvider — TanStack Query: server cache, retries, offline queue
 *   NavigationContainer — auth stack vs. main tabs, driven by the session
 *
 * The session hydrates from expo-secure-store (Keychain/Keystore) on launch,
 * so a returning user lands straight on the Home dashboard with no spinner
 * beyond the first paint. Every screen reads design tokens from
 * src/theme/tokens.ts — no hard-coded colors.
 */
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { useSessionStore } from '@/store/session';
import { RootNavigator } from '@/navigation/root-navigator';
import { colors } from '@/theme/tokens';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      gcTime: 5 * 60_000,
    },
  },
});

export default function App() {
  const { hydrate, status } = useSessionStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Restore the persisted session (secure store) before mounting the
    // navigator so we never flash the auth stack at a signed-in user.
    void hydrate().finally(() => setReady(true));
  }, [hydrate]);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <NavigationContainer
          theme={{
            ...DefaultTheme,
            colors: {
              ...DefaultTheme.colors,
              background: colors.background,
              card: colors.card,
              text: colors.foreground,
              primary: colors.primary,
              border: colors.border,
            },
          }}
        >
          <StatusBar style="dark" />
          <RootNavigator signedIn={status === 'authenticated'} />
        </NavigationContainer>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
