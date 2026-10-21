/**
 * Config plugin: allow cleartext (plain http://) traffic on Android.
 *
 * The platform is reached over the local network as http://<lan-ip>:4100
 * (and :3001 for the admin console). Android 9+ blocks cleartext by
 * default, which would silently break every API call and the WebView on a
 * real device — this plugin sets android:usesCleartextTraffic="true" on
 * the main application in the generated AndroidManifest.xml.
 */
// Config plugins are loaded with `require()` by @expo/config-plugins, so
// this file stays CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAndroidManifest, AndroidConfig } = require('@expo/config-plugins');

module.exports = function withCleartextTraffic(config) {
  return withAndroidManifest(config, (modConfig) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    app.$['android:usesCleartextTraffic'] = 'true';
    return modConfig;
  });
};
