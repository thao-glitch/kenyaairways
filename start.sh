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

tcp_up() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null && exec 3>&- 3<&- && return 0 || return 1; }

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

# Open the browser once the user app answers.
(
  for _ in $(seq 1 90); do
    sleep 2
    if curl -sf -o /dev/null http://localhost:3000 2>/dev/null; then
      command -v xdg-open >/dev/null 2>&1 && xdg-open http://localhost:3000 >/dev/null 2>&1
      command -v open >/dev/null 2>&1 && open http://localhost:3000 >/dev/null 2>&1
      exit 0
    fi
  done
) &

echo "Starting — user :3000 · admin :3001 · api :4100  (Ctrl-C stops everything)"
exec pnpm dev
