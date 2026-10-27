/**
 * Admin console screen — the shell of the admin APK.
 *
 * Two modes behind one header:
 *   Console        — the FULL staff console, bundled in the APK as a static
 *                    export and bridged to the live PC API (or the on-device
 *                    engine when the PC is unreachable). Fallback: the remote
 *                    console URL if the bundled copy cannot load.
 *   Offline tools  — native screens driven by the on-device engine, for when
 *                    no PC is reachable (market stall, aircraft, dead wifi).
 *
 * - Back button walks WebView history first, exits only at the root.
 * - The API address is editable up front (fresh installs must be pointable
 *   at a LAN server); the bridge re-reads it on every request.
 * - The console's own token pair persists in SecureStore, so staff stay
 *   signed in between launches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { WebViewNavigation } from 'react-native-webview';
import { Button } from '@/components/ui';
import { BrandMark } from '@/components/brand-logo';
import { colors, radii, spacing, type } from '@/theme/tokens';
import { ConsoleHost, type ConsoleHostHandle } from '@/admin/console-host';
import { OfflineToolsScreen } from '@/admin/offline-tools';

type Mode = 'console' | 'offline';

export function AdminConsoleScreen() {
  const [mode, setMode] = useState<Mode>('console');
  const [nav, setNav] = useState<WebViewNavigation | null>(null);
  const consoleRef = useRef<ConsoleHostHandle>(null);

  const reload = useCallback(() => {
    consoleRef.current?.reload();
  }, []);

  // Hardware back → history, exit only at the console root.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav?.canGoBack) {
        consoleRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [nav?.canGoBack]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <BrandMark size={28} />
          <View>
            <Text style={{ ...type.title, color: colors.foreground }}>Kenya Airways.</Text>
            <Text style={{ ...type.caption, color: colors.mutedForeground }}>
              {mode === 'console' ? 'Staff console' : 'Offline tools'}
            </Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View
            style={{
              flexDirection: 'row',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radii.sm,
              overflow: 'hidden',
            }}
          >
            {(['console', 'offline'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMode(m)}
                style={{
                  paddingHorizontal: spacing.sm,
                  paddingVertical: spacing.xs,
                  backgroundColor: mode === m ? colors.primary : 'transparent',
                }}
              >
                <Text
                  style={{
                    ...type.caption,
                    fontWeight: '600',
                    color: mode === m ? colors.primaryForeground : colors.mutedForeground,
                  }}
                >
                  {m === 'console' ? 'Console' : 'Offline'}
                </Text>
              </Pressable>
            ))}
          </View>
          {mode === 'console' ? (
            <View style={{ width: 96 }}>
              <Button title="Reload" variant="secondary" onPress={reload} />
            </View>
          ) : null}
        </View>
      </View>

      {mode === 'offline' ? (
        <OfflineToolsScreen />
      ) : (
        <ConsoleHost ref={consoleRef} onNavStateChange={setNav} />
      )}
    </SafeAreaView>
  );
}
