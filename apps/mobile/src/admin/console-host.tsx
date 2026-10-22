/**
 * ConsoleHost — the WebView that carries the FULL admin console on the phone.
 *
 * Two sources behind one component:
 *   bundled (default) — `file:///android_asset/console/index.html`, the
 *     static-export console shipped inside the APK. Every `/api/…` fetch is
 *     forwarded through `console-shim` → `console-bridge` → (live PC API |
 *     on-device engine), so the console keeps working when the PC is gone.
 *   PC URL (fallback) — only used if the bundled assets somehow fail to load
 *     (or the staff explicitly points at another deployment); plain remote
 *     console, same bridging shim.
 *
 * Navigation inside the bundled console is full-page: the shim intercepts
 * link clicks and hard `location` assignments land here, where
 * `consoleNavigationTarget` maps them onto the exported HTML files. WebView
 * history therefore behaves like the browser's — the hardware back button
 * (owned by the screen) walks it naturally.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { ServerSettings } from '@/components/server-settings';
import { getAdminBase, getApiBase } from '@/lib/server';
import { colors, spacing } from '@/theme/tokens';
import {
  consoleHandle,
  consoleNavigationTarget,
  respondScript,
  CONSOLE_ASSET_BASE,
} from './console-bridge';
import { CONSOLE_SHIM } from './console-shim';

const BUNDLED_INDEX = `${CONSOLE_ASSET_BASE}/index.html`;

export interface ConsoleHostHandle {
  reload(): void;
  goBack(): void;
}

interface Props {
  onNavStateChange?: (nav: WebViewNavigation) => void;
}

export const ConsoleHost = forwardRef<ConsoleHostHandle, Props>(function ConsoleHost(
  { onNavStateChange },
  ref,
) {
  const webRef = useRef<WebView>(null);
  // Fallback only kicks in if the in-APK console cannot load at all.
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [apiBase, setApiBase] = useState(getApiBase());

  useImperativeHandle(
    ref,
    () => ({
      reload: () => webRef.current?.reload(),
      goBack: () => webRef.current?.goBack(),
    }),
    [],
  );

  // The shim rewrites uploaded-media <img> tags against this global; keep it
  // current when the staff retargets the API address in settings.
  useEffect(() => {
    webRef.current?.injectJavaScript(`window.__F13_API_BASE = ${JSON.stringify(apiBase)}; true;`);
  }, [apiBase]);

  const onMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    let msg: { t?: string; id?: number } & Record<string, unknown>;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg?.t !== 'api' || typeof msg.id !== 'number') return;
    const id = msg.id;
    consoleHandle(msg as never)
      .then((res) => webRef.current?.injectJavaScript(respondScript(res)))
      .catch(() =>
        webRef.current?.injectJavaScript(
          `window.__f13bridge && window.__f13bridge.fail(${id}, 'Bridge error'); true;`,
        ),
      );
  }, []);

  const shouldStart = useCallback((req: { url: string }) => {
    const { url } = req;
    // file:// routes → their bundled page (`file:///index.html`, a basePath
    // directory, …); asset files, http(s) and externals load as they come.
    const target = consoleNavigationTarget(url);
    if (target) {
      // Visible in logcat (ReactNativeJS) — the audit trail for redirects.
      console.log(`[F13] redirect ${url} -> ${target}`);
      webRef.current?.injectJavaScript(`window.location.replace(${JSON.stringify(target)}); true;`);
      return false;
    }
    return true;
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <WebView
        ref={webRef}
        // Remounts onto the PC console only in the fallback case.
        key={remoteUrl ?? 'bundled'}
        source={remoteUrl ? { uri: remoteUrl } : { uri: BUNDLED_INDEX }}
        injectedJavaScriptBeforeContentLoaded={`window.__F13_API_BASE = ${JSON.stringify(
          getApiBase(),
        )};\n${CONSOLE_SHIM}`}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={shouldStart}
        onNavigationStateChange={onNavStateChange}
        onError={() => {
          // Bundled assets unreadable → last resort: the live PC console.
          if (!remoteUrl) setRemoteUrl(getAdminBase());
        }}
        startInLoadingState
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        originWhitelist={['file://*', 'http://*', 'https://*']}
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
        {remoteUrl ? (
          <ServerSettings slot="admin" onChanged={() => setRemoteUrl(getAdminBase())} />
        ) : (
          <ServerSettings slot="api" onChanged={() => setApiBase(getApiBase())} />
        )}
      </View>
    </View>
  );
});
