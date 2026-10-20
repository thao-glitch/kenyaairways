#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# DOUBLE-CLICK THIS (macOS) — installs or upgrades everything, hands-free.
#   · first run  = full install (Node, pnpm, deps, secrets, databases,
#     schema, worldwide seed)
#   · later runs = in-place upgrade of the existing installation
# Extra flags pass through, e.g.  INSTALL.command --no-seed
# ══════════════════════════════════════════════════════════════════════
cd "$(dirname "$0")" || exit 1
# Self-heal: ZIP extraction sometimes drops the executable bit.
chmod +x setup.sh start.sh 2>/dev/null || true
exec bash ./setup.sh "$@"
