#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# build-installer.sh — produce ONE self-extracting file:
#   "Install Kenya Airways.sh"
#
# Double-click that single file and it extracts the whole platform into
# ~/KenyaAirways and runs the installer — no navigation, no unzip step.
# It carries the entire source inside itself (base of the script + an
# embedded .tar.gz appended after it), so it works offline for the
# source; pnpm still fetches Node packages on first install.
#
# The built .sh is a RELEASE asset (not committed to git — it is ~21 MB).
# Run this script to regenerate it for a new release, then:
#   gh release upload v1.0.0 "Install Kenya Airways.sh" --clobber
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

OUT="Install Kenya Airways.sh"

echo "▸ Packing committed source (git archive — excludes git-ignored files)"
# Use `git archive HEAD`, NOT a working-directory tarball: tarring "."
# would embed git-ignored local files — including .env with real secrets
# (that bug was caught before anything reached the release). git archive
# packs only tracked files, so .env, node_modules, dist, .next etc. are
# excluded automatically and exec bits are preserved.
if ! git diff --quiet HEAD 2>/dev/null || ! git diff --cached --quiet HEAD 2>/dev/null; then
  echo "  ⚠ working tree has uncommitted changes — packaging committed HEAD"
fi
git archive --format=tar.gz -o /tmp/ka-payload.tgz HEAD
echo "  ✓ payload: $(du -h /tmp/ka-payload.tgz | cut -f1) ($(tar tzf /tmp/ka-payload.tgz | wc -l) files)"

echo "▸ Writing the self-extracting stub"
STUB="/tmp/ka-stub.sh"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Kenya Airways — self-extracting installer
#
#   Double-click this file. It extracts the platform and installs it.
#   Everything lands in ~/KenyaAirways. Nothing to unzip, nothing to
#   navigate. (First run on Linux may ask you to trust/run it once.)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail

# byte offset of the embedded archive (the builder fills this in)
OFFSET=0000000000
DEST="${KA_DEST:-$HOME/KenyaAirways}"

c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
c_fail() { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }
c_step() { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }

SELF="${BASH_SOURCE[0]:-$0}"

c_step "Kenya Airways — extracting to $DEST"
mkdir -p "$DEST"
# Everything after this stub is a gzipped tarball; unpack it in place.
tail -c +$((10#$OFFSET + 1)) "$SELF" 2>/dev/null | tar xzf - -C "$DEST" \
  || c_fail "could not extract the embedded files (re-download this file)"
c_ok "source extracted"

cd "$DEST"
[ -f setup.sh ] || c_fail "setup.sh missing after extraction — re-download"

c_step "Running the installer (this sets up everything)"
exec bash setup.sh "$@"
STUBEOF

# Compute the stub length and write it into OFFSET (fixed 10 digits keeps
# the byte length identical, so the payload offset stays exact).
L=$(wc -c < "$STUB")
printf -v OFF '%010d' "$L"
sed "s/^OFFSET=0000000000$/OFFSET=$OFF/" "$STUB" > "$OUT"

echo "▸ Appending the embedded platform"
cat /tmp/ka-payload.tgz >> "$OUT"
chmod +x "$OUT"

echo
echo "✓ Built: $OUT  ($(du -h "$OUT" | cut -f1))"
echo "  Upload to the release with:"
echo "    gh release upload v1.0.0 \"$OUT\" --clobber"
