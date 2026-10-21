#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Start the whole platform: API :4100, user app :3000, admin :3001.
# Ensures the databases are up first (Docker or local), waits for the
# apps, then opens your browser. Ctrl-C stops everything.
# (Windows users: double-click START.bat instead.)
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] || { printf '\033[31mNothing installed yet — double-click setup.sh first.\033[0m\n'; exit 1; }

# Self-heal: @kenyaairways/shared's dist/ is git-ignored, so a fresh
# download ships source only. If it is missing (or stale) the three apps
# crash on type resolution — build it before starting.
if [ ! -f packages/shared/dist/index.d.ts ]; then
  printf '\033[36m▸ Building @kenyaairways/shared (first run)…\033[0m\n'
  pnpm --filter @kenyaairways/shared build >/dev/null 2>&1 || {
    printf '\033[31m✗ could not build @kenyaairways/shared — run ./setup.sh first.\033[0m\n'; exit 1; }
fi

tcp_up() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null && exec 3>&- 3<&- && return 0 || return 1; }

# Bundle-aware front door: releases ship either the traveller bundle
# (apps/web) or the admin bundle (apps/admin) — open whichever one is
# present here (the full repo has both; user app wins).
if [ -d apps/web ]; then
  FRONT_PORT=3000; FRONT_LABEL="user app"
else
  FRONT_PORT=3001; FRONT_LABEL="admin"
fi
FRONT_URL="http://localhost:$FRONT_PORT"

# Databases: prefer Docker, fall back to whatever is already running.
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker compose up -d db redis >/dev/null 2>&1 || true
fi
tcp_up localhost 5432 || printf '\033[33m⚠ PostgreSQL not reachable on :5432 — run ./setup.sh to install it.\033[0m\n'
tcp_up localhost 6379 || {
  if command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes --port 6379 >/dev/null 2>&1 || true
  else
    printf '\033[33m⚠ Redis not reachable — API runs, seat holds/jobs degrade.\033[0m\n'
  fi
}

# Open the browser once the front-door app answers.
(
  for _ in $(seq 1 90); do
    sleep 2
    if curl -sf -o /dev/null "$FRONT_URL" 2>/dev/null; then
      command -v xdg-open >/dev/null 2>&1 && xdg-open "$FRONT_URL" >/dev/null 2>&1
      command -v open >/dev/null 2>&1 && open "$FRONT_URL" >/dev/null 2>&1
      exit 0
    fi
  done
) &

echo "Starting — $FRONT_LABEL :$FRONT_PORT · api :4100  (Ctrl-C stops everything)"
exec pnpm dev
