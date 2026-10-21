#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# build-bundles.sh — build the TWO standalone release bundles:
#
#   ./build-bundles.sh user     → traveller bundle  (apps/web  + api)
#   ./build-bundles.sh admin    → admin bundle      (apps/admin + api)
#   ./build-bundles.sh all      → both
#
# Each bundle is a complete, independently installable platform (API +
# database + seed included) with ONE app as the front door:
#   user bundle  → boots and opens :3000
#   admin bundle → boots and opens :3001
#
# Per bundle this produces four RELEASE assets (never committed — they
# are many MB each):
#   Install-Kenya-Airways-User.sh     self-extracting Linux installer
#   Install-Kenya-Airways-User.exe    self-extracting Windows installer
#   Install-Kenya-Airways-User.desktop  double-click launcher for the .sh
#   KenyaAirways-Traveller-Source.zip pruned source tree (INSTALL.sh entry)
#   (same four, -Admin, for the admin bundle)
#
# Payload rule (same as build-installer.sh): always `git archive HEAD`
# — committed files only, so .env secrets and build output never ship.
# The staged tree then gets the OTHER app pruned away.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

WHAT="${1:-all}"
case "$WHAT" in
  user|admin|all) ;;
  *) echo "usage: $0 [user|admin|all]"; exit 1 ;;
esac

command -v makensis >/dev/null 2>&1 || {
  echo "makensis not found — install it with: sudo apt install nsis"; exit 1; }

# ── prune one bundle out of a staged tree ─────────────────────────────
# $1 = stage dir, $2 = which app this bundle IS (user|admin)
prune_stage() {
  local stage="$1" bundle="$2" other svc
  if [ "$bundle" = user ]; then
    other=apps/admin; svc=admin
  else
    other=apps/web;   svc=web
  fi
  rm -rf "$stage/$other"

  # docker-compose: drop the service block for the pruned app so
  # `docker compose up -d db redis` never validates a missing Dockerfile.
  # Block ends at the next service key (2-space) or top-level key.
  if [ -f "$stage/docker-compose.yml" ]; then
    awk -v svc="$svc" '
      {
        if (skip) {
          if ($0 ~ /^  [A-Za-z0-9_-]+:/ || $0 ~ /^[A-Za-z]/) skip = 0
          else next
        }
        if ($0 == "  " svc ":") { skip = 1; next }
        print
      }' "$stage/docker-compose.yml" > "$stage/docker-compose.yml.new"
    mv "$stage/docker-compose.yml.new" "$stage/docker-compose.yml"
  fi

  # Banner at the top of the README so an extracted bundle says what it is.
  local title note
  if [ "$bundle" = user ]; then
    title="Traveller app bundle"
    note="This download contains the **traveller web app** (\`apps/web\`), the API and \`packages/shared\`. It does **not** include the staff admin console — that is a separate release."
  else
    title="Admin app bundle"
    note="This download contains the **staff admin console** (\`apps/admin\`), the API and \`packages/shared\`. It does **not** include the traveller web app — that is a separate release. Admin login: \`admin@kenyaairways.example\` / \`Password123!\`"
  fi
  { printf '> **%s** — %s\n> Front door: `%s`. One file installs it (Windows: the `.exe`, Linux: the `.sh`), or run `INSTALL.sh` from an extracted ZIP.\n\n' \
      "$title" "$note" \
      "$([ "$bundle" = user ] && echo 'http://localhost:3000' || echo 'http://localhost:3001')"
    cat "$stage/README.md"
  } > "$stage/README.md.new"
  mv "$stage/README.md.new" "$stage/README.md"
}

# ── build one bundle ──────────────────────────────────────────────────
build_one() {
  local bundle="$1" label tagword other_dir
  if [ "$bundle" = user ]; then
    label="User"; tagword="traveller"; other_dir=apps/admin
  else
    label="Admin"; tagword="admin"; other_dir=apps/web
  fi

  local out_sh="Install-Kenya-Airways-$label.sh"
  local out_exe="Install-Kenya-Airways-$label.exe"
  local out_desktop="Install-Kenya-Airways-$label.desktop"
  local stage="/tmp/ka-bundle-$bundle"
  local nsi="/tmp/ka-bundle-$bundle.nsi"

  echo
  echo "══ Building the $tagword bundle ═══════════════════════════════"

  echo "▸ Staging committed source (git archive HEAD)"
  rm -rf "$stage"; mkdir -p "$stage"
  git archive --format=tar HEAD | tar -x -C "$stage"
  prune_stage "$stage" "$bundle"
  local count
  count=$(find "$stage" -type f | wc -l)
  echo "  ✓ $count files ($other_dir pruned, compose + README adjusted)"
  [ -d "$stage/$other_dir" ] && { echo "  ✗ prune failed — $other_dir still present"; exit 1; }

  # Windows cmd needs CRLF .bat (git archive ships LF blobs).
  find "$stage" -name '*.bat' -exec sed -i -e 's/\r$//' -e 's/$/\r/' {} +

  # ── 1. self-extracting Linux .sh ──────────────────────────────────
  echo "▸ Packing $out_sh (self-extracting Linux installer)"
  local stub="/tmp/ka-stub-$bundle.sh" payload="/tmp/ka-payload-$bundle.tgz"
  tar -czf "$payload" -C "$stage" .
  # The stub below is byte-identical to build-installer.sh's, except for
  # the banner line; OFFSET is padded to a fixed 10 digits so writing it
  # in never shifts the payload offset.
  cat > "$stub" <<STUBEOF
#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Kenya Airways — $tagword bundle, self-extracting installer
#
#   Double-click this file. It extracts the bundle and installs it.
#   Everything lands in ~/KenyaAirways. Nothing to unzip, nothing to
#   navigate. (First run on Linux may ask you to trust/run it once.)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

# byte offset of the embedded archive (the builder fills this in)
OFFSET=0000000000
DEST="\${KA_DEST:-\$HOME/KenyaAirways}"

c_ok()   { printf '  \033[32m✓\033[0m %s\n' "\$*"; }
c_fail() { printf '\033[31m✗ %s\033[0m\n' "\$*"; exit 1; }
c_step() { printf '\n\033[36m▸ %s\033[0m\n' "\$*"; }

SELF="\${BASH_SOURCE[0]:-\$0}"

c_step "Kenya Airways — extracting to \$DEST"
mkdir -p "\$DEST"
# Everything after this stub is a gzipped tarball; unpack it in place.
tail -c +\$((10#\$OFFSET + 1)) "\$SELF" 2>/dev/null | tar xzf - -C "\$DEST" \\
  || c_fail "could not extract the embedded files (re-download this file)"
c_ok "source extracted"

cd "\$DEST"
[ -f setup.sh ] || c_fail "setup.sh missing after extraction — re-download"

c_step "Running the installer (this sets up everything)"
exec bash setup.sh "\$@"
STUBEOF
  local len off
  len=$(wc -c < "$stub")
  printf -v off '%010d' "$len"
  sed "s/^OFFSET=0000000000$/OFFSET=$off/" "$stub" > "$out_sh"
  cat "$payload" >> "$out_sh"
  chmod +x "$out_sh"
  echo "  ✓ $(du -h "$out_sh" | cut -f1)"

  # ── 2. self-extracting Windows .exe ───────────────────────────────
  echo "▸ Building $out_exe (NSIS)"
  local front_url
  if [ "$bundle" = user ]; then
    front_url="http://localhost:3000"
  else
    front_url="http://localhost:3001"
  fi
  local abs_out="$PWD/$out_exe"
  cat > "$nsi" <<NSIEOF
; ── Kenya Airways ($tagword bundle) — self-extracting Windows installer ─
Unicode true
Name "Kenya Airways ($label)"
OutFile "__OUT__"
InstallDir "\$PROFILE\\KenyaAirways"
RequestExecutionLevel user          ; no admin needed — installs to your profile
SetCompressor lzma
SilentInstall normal                ; show a window, start immediately (no wizard buttons)
Page instfiles
ShowInstDetails show

Section "Install"
  ; Extract into the target. SetOverwrite on (default) refreshes files on an
  ; upgrade but never deletes, and .env / node_modules / the database are not
  ; in the archive — so every booking, user and setting survives an in-place
  ; upgrade (exactly like the Linux .sh).
  SetOutPath "\$INSTDIR"
  File /r "__STAGE__/*"
  DetailPrint "Source extracted to \$INSTDIR"

  ; Hand off to the Windows installer (the twin of setup.sh) in its own
  ; visible window so you can watch it work.
  ExecShell "open" "\$INSTDIR\\INSTALL.bat"
  MessageBox MB_ICONINFORMATION "Kenya Airways ($label) is installing in a new window.\$\\r\$\\nFollow it until it prints 'Install complete'. Then double-click START.bat to run the apps.\$\\r\$\\n\$\\r\$\\nFront door  __FRONT__\$\\r\$\\nAPI         http://localhost:4100"
SectionEnd
NSIEOF
  sed -e "s#__OUT__#$abs_out#g" -e "s#__STAGE__#$stage#g" -e "s#__FRONT__#$front_url#g" "$nsi" > "$nsi.real"
  makensis "$nsi.real" 2>&1 | tail -4

  # ── 3. desktop launcher for the .sh ───────────────────────────────
  # Quoted heredoc + sed placeholders: the Exec line contains $(dirname)
  # and \$ which must reach the FILE literally, not run at build time.
  # Inner filenames are single-quoted (never \" — GLib rejects it) and
  # the substitution is \\$ (two backslashes) so desktop-file-validate
  # and the GLib runtime parser are both satisfied. Probes the hyphen
  # asset name, its GitHub dot-mangled twin, and the ZIP entry point.
  # bundle asset names use hyphens (no spaces) → GitHub never rewrites
  # them, so one probe covers the asset; INSTALL.sh covers ZIP downloads.
  local dotmangled="$out_sh"
  cat > "$out_desktop" <<'DESEOF'
[Desktop Entry]
Type=Application
Version=1.0
Name=Install Kenya Airways (__LABEL__)
GenericName=Platform installer
Comment=Install or upgrade the Kenya Airways __TAGWORD__ bundle automatically (no terminal needed)
Exec=bash -c "cd \\$(dirname '%k') && if [ -f '__SH__' ]; then exec bash '__SH__'; fi; if [ -f '__DOT__' ]; then exec bash '__DOT__'; fi; if [ -f INSTALL.sh ]; then exec bash INSTALL.sh; fi; echo 'Installer script not found next to this launcher'; exit 1"
Terminal=true
Icon=utilities-terminal
Categories=Utility;
StartupNotify=false
DESEOF
  sed -i -e "s#__LABEL__#$label#g" -e "s#__TAGWORD__#$tagword#g" \
         -e "s#__SH__#$out_sh#g" -e "s#__DOT__#$dotmangled#g" "$out_desktop"
  # The written \\$ must be EXACTLY two backslashes for GLib's two parser
  # layers (desktop-file-validate wants \, GLib runtime wants \\). Verify.
  grep -q 'cd \\\\$(dirname' "$out_desktop" || {
    echo "  ✗ .desktop Exec escaping wrong:"; grep '^Exec=' "$out_desktop"; exit 1; }

  # ── verify what actually shipped ──────────────────────────────────
  echo "▸ Verifying contents"
  local vdir n leak
  vdir=$(mktemp -d)
  if 7z x -y "-o$vdir" "$out_exe" >/dev/null 2>&1; then
    n=$(find "$vdir" -type f | wc -l)
    leak=no
    [ -f "$vdir/.env" ] && leak="YES — LEAK!"
    [ -d "$vdir/$other_dir" ] && leak="$leak OTHER-APP-PRESENT"
    echo "  .exe tree: $n files (stage had $count) · secrets/other-app: $leak"
    [ "$n" -eq "$count" ] || echo "  ⚠ file-count mismatch"
  else
    echo "  ⚠ 7z could not open the .exe"
  fi
  rm -rf "$vdir"
  # and the .sh payload: strip the stub, unpack, compare
  vdir=$(mktemp -d)
  tail -c +$((len + 1)) "$out_sh" | tar xzf - -C "$vdir" 2>/dev/null || true
  n=$(find "$vdir" -type f | wc -l)
  echo "  .sh payload: $n files · $other_dir present: $([ -d "$vdir/$other_dir" ] && echo YES || echo no)"
  rm -rf "$vdir"

  # ── 4. source ZIP — the same pruned tree for direct download ──────
  # `zip -r -X .` from the stage root: entries without a ./ prefix (so
  # INSTALL.sh and friends sit at the top level) and dotfiles included.
  local out_zip zipword
  if [ "$bundle" = user ]; then zipword="Traveller"; else zipword="Admin"; fi
  out_zip="KenyaAirways-$zipword-Source.zip"
  echo "▸ Packing $out_zip (source zip)"
  local abs_zip="$PWD/$out_zip"
  rm -f "$abs_zip"
  (cd "$stage" && zip -q -r -X "$abs_zip" .)
  local zline
  zline=$(unzip -l "$out_zip" | tail -1)
  echo "  ✓ $zline"
  if unzip -l "$out_zip" | grep -q ' \.env$'; then
    echo "  ✗ .env leaked into $out_zip"; exit 1
  fi
  if unzip -l "$out_zip" | grep -q "$other_dir/"; then
    echo "  ✗ $other_dir present in $out_zip"; exit 1
  fi
  unzip -l "$out_zip" | grep -q 'INSTALL.sh' || { echo "  ✗ INSTALL.sh missing from $out_zip"; exit 1; }

  echo "✓ Built:"
  echo "    $out_sh      $(du -h "$out_sh" | cut -f1)"
  echo "    $out_exe     $(du -h "$out_exe" | cut -f1)"
  echo "    $out_desktop $(du -h "$out_desktop" | cut -f1)"
  echo "    $out_zip     $(du -h "$out_zip" | cut -f1)"
  rm -rf "$stage" "$nsi" "$nsi.real" "$stub" "$payload"
}

if [ "$WHAT" = user ] || [ "$WHAT" = all ]; then build_one user; fi
if [ "$WHAT" = admin ] || [ "$WHAT" = all ]; then build_one admin; fi

echo
echo "Upload (delete-then-upload pattern — --clobber deletes BEFORE the"
echo "transfer starts, which can leave the release missing an asset):"
if [ "$WHAT" = user ] || [ "$WHAT" = all ]; then
  echo "  gh release delete-asset USER_TAG 'Install-Kenya-Airways-User.sh' -y 2>/dev/null || true"
  echo "  gh release upload     USER_TAG 'Install-Kenya-Airways-User.sh' 'Install-Kenya-Airways-User.exe' 'Install-Kenya-Airways-User.desktop' 'KenyaAirways-Traveller-Source.zip'"
fi
if [ "$WHAT" = admin ] || [ "$WHAT" = all ]; then
  echo "  gh release delete-asset ADMIN_TAG 'Install-Kenya-Airways-Admin.sh' -y 2>/dev/null || true"
  echo "  gh release upload     ADMIN_TAG 'Install-Kenya-Airways-Admin.sh' 'Install-Kenya-Airways-Admin.exe' 'Install-Kenya-Airways-Admin.desktop' 'KenyaAirways-Admin-Source.zip'"
fi
