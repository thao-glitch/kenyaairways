#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# build-installer-win.sh — produce ONE self-extracting Windows file:
#   "Install Kenya Airways.exe"
#
# Double-click that single file and it extracts the whole platform into
# %USERPROFILE%\KenyaAirways and launches INSTALL.bat — no navigation, no
# unzip step (the Windows twin of "Install Kenya Airways.sh").
#
# The payload is `git archive HEAD` (committed files only), so git-ignored
# secrets (.env) and build output never ship — same rule as the Linux .sh.
#
# Requires makensis (Debian/Ubuntu: sudo apt install nsis). The built .exe
# is a RELEASE asset (not committed — it is ~7 MB). Regenerate, then:
#   gh release upload v1.0.0 "Install Kenya Airways.exe" --clobber
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

OUT="$PWD/Install Kenya Airways.exe"
STAGE=/tmp/ka-win-stage
NSI=/tmp/ka-win-installer.nsi

command -v makensis >/dev/null 2>&1 || {
  echo "makensis not found — install it with: sudo apt install nsis"; exit 1; }

echo "▸ Packing committed source (git archive — excludes git-ignored files)"
# git archive packs only tracked files: .env, node_modules, dist, .next are
# excluded automatically. Tarring "." instead would leak real local secrets.
rm -rf "$STAGE"; mkdir -p "$STAGE"
git archive --format=tar HEAD | tar -x -C "$STAGE"
# Windows cmd expects CRLF in .bat files; an LF-only batch can silently
# break goto/label jumps. git archive packs the normalised (LF) blob, so
# convert the .bat files to CRLF here, right before packing them into the
# .exe. (Idempotent: strips any existing CR, then adds exactly one.)
find "$STAGE" -name '*.bat' -exec sed -i -e 's/\r$//' -e 's/$/\r/' {} +
COUNT=$(find "$STAGE" -type f | wc -l)
echo "  ✓ payload: $COUNT files (.bat normalised to CRLF for cmd.exe)"

echo "▸ Writing the NSIS installer script"
cat > "$NSI" <<'NSIEOF'
; ── Kenya Airways — self-extracting Windows installer ───────────────────
; Double-click this file. It extracts the platform into
; %USERPROFILE%\KenyaAirways and runs INSTALL.bat, which sets up Node,
; the databases, the schema and the worldwide seed — then start with
; START.bat. Re-running this same .exe upgrades the install in place.
Unicode true
Name "Kenya Airways."
OutFile "__OUT__"
InstallDir "$PROFILE\KenyaAirways"
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
  SetOutPath "$INSTDIR"
  File /r "__STAGE__/*"
  DetailPrint "Source extracted to $INSTDIR"

  ; Hand off to the Windows installer (the twin of setup.sh) in its own
  ; visible window so you can watch it work.
  ExecShell "open" "$INSTDIR\INSTALL.bat"
  MessageBox MB_ICONINFORMATION "Installing Kenya Airways. in a new window.$\r$\nFollow it until it prints 'Install complete'. Then double-click START.bat to run the apps.$\r$\n$\r$\nUser app  http://localhost:3000$\r$\nAdmin     http://localhost:3001"
SectionEnd
NSIEOF

# Fill the two placeholders (quoted heredoc keeps NSIS's $vars literal).
sed -e "s#__OUT__#$OUT#g" -e "s#__STAGE__#$STAGE#g" "$NSI" > "$NSI.real"

echo "▸ Building the .exe (makensis)"
makensis "$NSI.real" 2>&1 | tail -5

echo
echo "✓ Built: Install Kenya Airways.exe  ($(du -h "$OUT" | cut -f1))"

# ── verify what shipped inside the .exe (7z unpacks NSIS installers) ────
echo "▸ Verifying contents"
VDIR=$(mktemp -d)
if 7z e -y "-o$VDIR" "$OUT" >/dev/null 2>&1; then
  N=$(find "$VDIR" -type f | wc -l)
  echo "  payload check: $N file(s) inside the archive (raw view; full tree below via 7z x)"
  rm -rf "$VDIR"
fi
VDIR2=$(mktemp -d)
if 7z x -y "-o$VDIR2" "$OUT" >/dev/null 2>&1; then
  N=$(find "$VDIR2" -type f | wc -l)
  LEAK=$([ -f "$VDIR2/.env" ] && echo "YES — LEAK!" || echo "no")
  echo "  extracted tree: $N files (expected $COUNT)"
  echo "  .env leaked:    $LEAK"
  [ "$N" -eq "$COUNT" ] || echo "  ⚠ file-count mismatch"
  rm -rf "$VDIR2"
else
  echo "  ⚠ 7z could not open the .exe for verification"
fi

echo
echo "Upload to the release with:"
echo "  gh release upload v1.0.0 \"Install Kenya Airways.exe\" --clobber"
