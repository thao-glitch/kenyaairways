/**
 * Admin console screen — the staff console (apps/admin, :3001) rendered in
 * a native WebView. This is the entire UI of the admin APK variant: a thin
 * shell with the airline header, a reload control and the console address
 * setting (LAN address of the machine running the platform).
 *
 * - Back button walks WebView history first, exits only at the root.
 * - The address is editable up front (fresh installs must be pointable at
 *   a LAN server) and a change remounts the view onto the new URL.
 * - Cookies persist, so staff stay signed in between launches.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { ServerSettings } from '@/components/server-settings';
import { getAdminBase } from '@/lib/server';
import { Button } from '@/components/ui';
import { colors, spacing, type } from '@/theme/tokens';

export function AdminConsoleScreen() {
  const [url, setUrl] = useState(getAdminBase());
  const [nav, setNav] = useState<WebViewNavigation | null>(null);
  const webRef = useRef<WebView>(null);

  const reload = useCallback(() => {
    setUrl(getAdminBase());
    webRef.current?.reload();
  }, []);

  // Hardware back → history, exit only at the console root.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (nav?.canGoBack) {
        webRef.current?.goBack();
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
        <View>
          <Text style={{ ...type.title, color: colors.foreground }}>Kenya Airways</Text>
          <Text style={{ ...type.caption, color: colors.mutedForeground }}>Staff console</Text>
        </View>
        <View style={{ width: 110 }}>
          <Button title="Reload" variant="secondary" onPress={reload} />
        </View>
      </View>

      <WebView
        ref={webRef}
        // Remounts onto the (possibly new) address after a settings change.
        key={url}
        source={{ uri: url }}
        onLoad={(e) => setNav({ ...nav, canGoBack: e.nativeEvent.canGoBack } as WebViewNavigation)}
        onNavigationStateChange={setNav}
        startInLoadingState
        renderLoading={() => (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        setSupportMultipleWindows={false}
        style={{ backgroundColor: colors.background }}
      />

      <View
        style={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <ServerSettings slot="admin" onChanged={() => setUrl(getAdminBase())} />
      </View>
    </SafeAreaView>
  );
}
