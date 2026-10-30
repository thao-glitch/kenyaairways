#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# build-apk.sh — build the TWO installable Android APKs:
#
#   ./build-apk.sh user     → traveller APK (standalone engine, no console)
#   ./build-apk.sh admin    → admin APK (FULL staff console bundled + bridge)
#   ./build-apk.sh all      → both
#
# The admin APK static-exports apps/admin (ADMIN_STATIC_EXPORT=1) and copies
# the result into android/app/src/main/assets/console/, so the phone carries
# the whole console. The WebView bridge inside the APK targets the PC API
# when it is reachable and the on-device engine when it is not — one APK,
# online and offline.
#
# The android/ tree is GENERATED (expo prebuild) and gitignored; this script
# creates it when missing, retargets the admin identity into it, builds, and
# restores the traveller identity afterwards (a trap restores it even on
# failure, so the tree never stays pointing at the wrong package).
#
# Outputs (gitignored dist/):
#   dist/Kenya-Airways-User.apk
#   dist/Kenya-Airways-Admin.apk
#   dist/*.apk.zip, dist/*.apk.sha256, dist/SHA256SUMS.txt
#
# Both are signed with android/app/debug.keystore (release type already
# points at it). The two JS bundles MUST differ — the script verifies it
# instead of trusting the env var.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

WHAT="${1:-all}"
case "$WHAT" in
  user|admin|all) ;;
  *) echo "usage: $0 [user|admin|all]"; exit 1 ;;
esac

export JAVA_HOME="${JAVA_HOME:-$HOME/opt/jdk17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

MOBILE="$PWD/apps/mobile"
ANDROID="$MOBILE/android"
BG="$ANDROID/app/build.gradle"
STR="$ANDROID/app/src/main/res/values/strings.xml"
CONSOLE_ASSETS="$ANDROID/app/src/main/assets/console"
# Release builds target real phones, not desktop emulators. Keeping only the
# two ARM ABIs removes ~37 MB of x86-only libraries from each APK. Set
# F13_ANDROID_ARCHS=x86_64 when you need an emulator-test build.
ANDROID_ARCHS="${F13_ANDROID_ARCHS:-arm64-v8a,armeabi-v7a}"
DIST="${F13_DIST_DIR:-$PWD/dist}"
mkdir -p "$DIST"

USER_APK="$DIST/Kenya-Airways-User.apk"
ADMIN_APK="$DIST/Kenya-Airways-Admin.apk"

USER_BUNDLE_MD5=""

apk_bundle_md5() { # $1 = apk path → prints md5 of its JS bundle
  local tmp
  tmp=$(mktemp)
  unzip -p "$1" assets/index.android.bundle > "$tmp"
  md5sum "$tmp" | cut -d' ' -f1
  rm -f "$tmp"
}

ensure_android_tree() {
  if [ ! -f "$BG" ]; then
    echo "▸ android/ tree missing — running expo prebuild"
    (cd "$MOBILE" && npx expo prebuild -p android --no-install)
  fi
  [ -f "$BG" ] || { echo "✗ prebuild did not produce $BG"; exit 1; }
}

configure_android_packaging() {
  local gp="$ANDROID/gradle.properties"
  [ -f "$gp" ] || { echo "✗ missing $gp"; exit 1; }

  # Compress the .so files in the APK and extract them on install. This makes
  # the download roughly half the size; installed size is unchanged.
  if grep -q '^expo.useLegacyPackaging=' "$gp"; then
    sed -i 's/^expo.useLegacyPackaging=.*/expo.useLegacyPackaging=true/' "$gp"
  else
    printf '\nexpo.useLegacyPackaging=true\n' >> "$gp"
  fi

  # The native architecture list is read by the React Native Gradle plugin.
  if grep -q '^reactNativeArchitectures=' "$gp"; then
    sed -i "s/^reactNativeArchitectures=.*/reactNativeArchitectures=$ANDROID_ARCHS/" "$gp"
  else
    printf '\nreactNativeArchitectures=%s\n' "$ANDROID_ARCHS" >> "$gp"
  fi

  echo "  ✓ Android ABIs: $ANDROID_ARCHS · native libs compressed"
}

verify_apk_packaging() {
  local apk="$1" abi entry
  local listing
  listing=$(unzip -l "$apk")

  for abi in ${ANDROID_ARCHS//,/ }; do
    [[ "$listing" == *"lib/$abi/"* ]] || {
      echo "✗ $apk is missing native libraries for $abi"
      exit 1
    }
  done

  for abi in arm64-v8a armeabi-v7a x86_64 x86; do
    case ",$ANDROID_ARCHS," in
      *",$abi,"*) ;;
      *)
        if [[ "$listing" == *"lib/$abi/"* ]]; then
          echo "✗ $apk unexpectedly contains $abi libraries"
          exit 1
        fi
        ;;
    esac
  done

  # useLegacyPackaging=true must set extractNativeLibs=true; otherwise install
  # would fail because compressed libs would not be extracted.
  local manifest
  manifest=$("$ANDROID_HOME/build-tools/36.0.0/aapt" dump xmltree "$apk" AndroidManifest.xml 2>/dev/null || true)
  [[ "$manifest" == *"android:extractNativeLibs"*"0xffffffff"* ]] || {
    echo "✗ $apk does not extract compressed native libraries"
    exit 1
  }

  # Read the whole listing before awk exits: `unzip -v | awk '{...; exit}'`
  # dies with SIGPIPE under pipefail and aborts the build.
  local verbose
  verbose=$(unzip -v "$apk")
  entry=$(printf '%s\n' "$verbose" | awk '/lib\/.*\.so$/ && !found {print $2; found=1}')
  [[ "$entry" == *"Defl:"* || "$entry" == *"Defl:N"* ]] || {
    echo "✗ $apk native libraries are not compressed"
    exit 1
  }
}

make_apk_extras() {
  local apk="$1" base dir
  base=$(basename "$apk")
  dir=$(dirname "$apk")
  (
    cd "$dir"
    rm -f "$base.zip" "$base.sha256"
    zip -9 -q "$base.zip" "$base"
    sha256sum "$base" > "$base.sha256"
  )
  echo "  ✓ $dir/$base.zip + $base.sha256"
}

retarget_admin_identity() {
  grep -q "ke.co.kenyaairways.admin" "$BG" || \
    sed -i "s/applicationId 'ke.co.kenyaairways'/applicationId 'ke.co.kenyaairways.admin'/" "$BG"
  grep -q '>Kenya Airways Admin.<' "$STR" || \
    sed -i 's|<string name="app_name">Kenya Airways\.</string>|<string name="app_name">Kenya Airways Admin\.</string>|' "$STR"
}

restore_traveller_identity() {
  sed -i "s/applicationId 'ke.co.kenyaairways.admin'/applicationId 'ke.co.kenyaairways'/" "$BG" 2>/dev/null || true
  sed -i 's|<string name="app_name">Kenya Airways Admin\.</string>|<string name="app_name">Kenya Airways\.</string>|' "$STR" 2>/dev/null || true
}
trap restore_traveller_identity EXIT

build_console_export() {
  echo "▸ Static-exporting the admin console (ADMIN_STATIC_EXPORT=1)"
  (cd "$PWD/apps/admin" && ADMIN_STATIC_EXPORT=1 npx next build)
  [ -f apps/admin/out/index.html ] || { echo "✗ static export produced no index.html"; exit 1; }
  echo "▸ Copying the console into the APK assets"
  rm -rf "$CONSOLE_ASSETS"
  mkdir -p "$CONSOLE_ASSETS"
  cp -r apps/admin/out/. "$CONSOLE_ASSETS/"
  local n
  n=$(find "$CONSOLE_ASSETS" -type f | wc -l)
  echo "  ✓ $n console files staged"
  [ -f "$CONSOLE_ASSETS/index.html" ] || { echo "✗ console index.html missing from assets"; exit 1; }
}

build_one() {
  local variant="$1" # user | admin
  local label envvar out
  if [ "$variant" = user ]; then
    label="traveller"; envvar=""; out="$USER_APK"
  else
    label="admin"; envvar="admin"; out="$ADMIN_APK"
  fi

  echo
  echo "══ Building the $label APK ═════════════════════════════════════"
  ensure_android_tree
  configure_android_packaging

  if [ "$variant" = admin ]; then
    build_console_export
    retarget_admin_identity
  else
    # The traveller APK must never carry the console.
    rm -rf "$CONSOLE_ASSETS"
  fi

  echo "▸ Nuking every stale JS bundle (find, don't guess)"
  find "$ANDROID/app/build" -name 'index.android.bundle*' -print -delete 2>/dev/null || true
  find "$ANDROID/app/build" -name '*.hbc' -print -delete 2>/dev/null || true

  echo "▸ gradle assembleRelease (EXPO_PUBLIC_APP_VARIANT=${envvar:-<unset>})"
  # Fresh daemon so EXPO_PUBLIC_* reaches Metro's process env.
  (cd "$ANDROID" && ./gradlew --stop >/dev/null 2>&1 || true)
  local log=/tmp/opencode/gradle-"$variant".log
  mkdir -p "$(dirname "$log")"
  (cd "$ANDROID" && EXPO_PUBLIC_APP_VARIANT="$envvar" ./gradlew assembleRelease) \
    > "$log" 2>&1 || { echo "$label BUILD FAILED:"; tail -30 "$log"; exit 1; }
  grep -E 'BUILD (SUCCESSFUL|FAILED)' "$log" | tail -1

  cp "$ANDROID/app/build/outputs/apk/release/app-release.apk" "$out"

  echo "▸ Verifying $out"
  local md5 pkg
  md5=$(apk_bundle_md5 "$out")
  echo "  js bundle md5: $md5"

  # Match against the captured listing with bash globbing — a
  # `printf | grep -q` pipeline under pipefail is a SIGPIPE race (grep -q
  # exits on the first match, printf then dies writing the rest).
  local listing
  listing=$(unzip -l "$out")

  if [ "$variant" = admin ]; then
    [[ "$listing" == *"assets/console/index.html"* ]] \
      || { echo "✗ console index.html missing from the admin APK"; exit 1; }
    [[ "$listing" == *"assets/console/admin.html"* ]] \
      || { echo "✗ console admin.html missing from the admin APK"; exit 1; }
    # grep -c reads all input (no early exit), so no SIGPIPE race here.
    echo "  ✓ console bundled ($(printf '%s' "$listing" | grep -c 'assets/console/' || true) files)"
  else
    if [[ "$listing" == *"assets/console/"* ]]; then
      echo "✗ console leaked into the traveller APK"; exit 1
    fi
    echo "  ✓ no console assets (traveller stays lean)"
  fi

  local aapt="$ANDROID_HOME/build-tools/36.0.0/aapt"
  if [ -x "$aapt" ]; then
    # Capture first — `| head` under pipefail dies of SIGPIPE when aapt
    # keeps writing after head closes the pipe.
    local badging
    badging=$("$aapt" dump badging "$out" 2>/dev/null) || badging=""
    pkg=$(printf '%s\n' "$badging" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p" | sed -n '1p')
    echo "  package: ${pkg:-<unknown>}"
    if [ "$variant" = admin ]; then
      [ "$pkg" = "ke.co.kenyaairways.admin" ] || { echo "✗ wrong package id"; exit 1; }
    else
      [ "$pkg" = "ke.co.kenyaairways" ] || { echo "✗ wrong package id"; exit 1; }
    fi
  fi

  verify_apk_packaging "$out"
  echo "  ✓ expected ABIs only, compressed native libraries, extractNativeLibs=true"

  if [ "$variant" = user ]; then
    USER_BUNDLE_MD5="$md5"
  else
    # Compare against the traveller bundle when we have one (all-mode, or a
    # previously built user APK still on disk) — an identical bundle means
    # the env var never reached Metro and the admin APK would boot the
    # traveller app.
    local other_md5=""
    if [ -n "$USER_BUNDLE_MD5" ]; then
      other_md5="$USER_BUNDLE_MD5"
    elif [ -f "$USER_APK" ]; then
      other_md5=$(apk_bundle_md5 "$USER_APK")
    fi
    if [ -n "$other_md5" ]; then
      if [ "$md5" = "$other_md5" ]; then
        echo "✗ admin JS bundle is IDENTICAL to the traveller bundle — env var did not reach Metro"
        exit 2
      fi
      echo "  ✓ admin bundle differs from traveller ($other_md5)"
    else
      echo "  ⚠ no traveller bundle to compare against (run '$0 user' first for the full check)"
    fi
  fi

  echo "✓ $label APK → $out ($(du -h "$out" | cut -f1))"
}

if [ "$WHAT" = user ] || [ "$WHAT" = all ]; then build_one user; fi
if [ "$WHAT" = admin ] || [ "$WHAT" = all ]; then build_one admin; fi

restore_traveller_identity
trap - EXIT

echo
echo "▸ Packaging download fallbacks and checksums"
for apk in "$USER_APK" "$ADMIN_APK"; do
  [ -f "$apk" ] && make_apk_extras "$apk"
done
(
  cd "$DIST"
  : > SHA256SUMS.txt
  for apk in Kenya-Airways-User.apk Kenya-Airways-Admin.apk; do
    [ -f "$apk" ] && sha256sum "$apk" >> SHA256SUMS.txt
  done
)

echo
echo "✓ Built:"
[ -f "$USER_APK" ] && echo "    $USER_APK   $(du -h "$USER_APK" | cut -f1)"
[ -f "$ADMIN_APK" ] && echo "    $ADMIN_APK  $(du -h "$ADMIN_APK" | cut -f1)"
[ -f "$DIST/SHA256SUMS.txt" ] && echo "    $DIST/SHA256SUMS.txt"
