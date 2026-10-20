#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# DOUBLE-CLICK THIS (macOS) — starts the whole platform and opens it.
#   user app :3000 · admin :3001 · API :4100. Close the window to stop.
# ══════════════════════════════════════════════════════════════════════
cd "$(dirname "$0")" || exit 1
chmod +x start.sh 2>/dev/null || true
exec bash ./start.sh
