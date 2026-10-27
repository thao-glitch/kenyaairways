#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# Kenya Airways platform — ONE script for first install AND upgrades.
#   ./setup.sh             install or upgrade everything in place
#   ./setup.sh --dev       …then start all three apps
#   ./setup.sh --no-seed   skip the demo-data seed
#   SKIP_PULL=1 ./setup.sh upgrade from a ZIP without git pulling
# Double-clickable from a file manager (GNOME: right-click → Run in
# Terminal). Windows users: double-click INSTALL.bat instead.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

DEV=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --no-seed) SEED=0 ;;
    -h|--help)
      sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) printf '\033[31mUnknown flag: %s (try --help)\033[0m\n' "$arg"; exit 1 ;;
  esac
done

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[36m▸ %s\033[0m\n' "$*"; }
ok()    { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[33m⚠ %s\033[0m\n' "$*"; }
fail()  { printf '\033[31m✗ %s\033[0m\n' "$*"; exit 1; }

bold "Kenya Airways. platform setup"
UPGRADE=0
if [ -d node_modules ] || [ -f .env ]; then UPGRADE=1; fi
if [ "$UPGRADE" = 1 ]; then warn "existing installation detected — upgrading in place (data preserved)"; fi

# ── 1. toolchain (auto-installs Node + pnpm when missing) ──────────────
step "Toolchain (Node 20+, pnpm)"
if ! command -v node >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    warn "installing Node.js 22 (sudo may ask for your password)…"
    command -v curl >/dev/null 2>&1 || sudo apt-get install -y curl
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
    sudo apt-get install -y nodejs
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    fail "Node.js 20+ is required. Install it from https://nodejs.org, then run this file again."
  fi
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || fail "Node 20+ required (found $(node -v)). Upgrade: nvm install 22"
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable 2>/dev/null || sudo corepack enable 2>/dev/null || true
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@latest --silent
fi
command -v pnpm >/dev/null 2>&1 || fail "pnpm could not be installed — install it manually (npm i -g pnpm) and rerun"
ok "node $(node -v) · pnpm $(pnpm -v)"

# ── 2. source update (upgrades pull the latest code) ───────────────────
if [ "$UPGRADE" = 1 ] && [ "${SKIP_PULL:-0}" != 1 ] && [ -d .git ]; then
  step "Updating source (git pull)"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "local changes present — skipping pull (or run with SKIP_PULL=1)"
  else
    git pull --ff-only 2>/dev/null && ok "up to date" || warn "pull skipped (offline or diverged)"
  fi
fi

# ── 3. workspace dependencies ─────────────────────────────────────────
step "Workspace dependencies"
pnpm install --silent
ok "dependencies installed"

# ── 3b. build @kenyaairways/shared ────────────────────────────────────
# Its dist/ is git-ignored, so a fresh ZIP/tarball download ships the
# SOURCE only. Without this build the API/web/admin cannot resolve the
# shared types and crash with dozens of TS errors on first run — so it
# is mandatory on first install (and a cheap no-op on upgrade).
step "Building @kenyaairways/shared (required for first run)"
if pnpm --filter @kenyaairways/shared build >/tmp/ka-shared-build.log 2>&1; then
  ok "shared package built → packages/shared/dist"
else
  warn "shared build failed — showing output:"
  tail -20 /tmp/ka-shared-build.log
  fail "could not build @kenyaairways/shared (the apps cannot start without it)"
fi

# ── 4. secrets ────────────────────────────────────────────────────────
step "Environment (.env with generated secrets)"
node scripts/bootstrap.mjs

# ── 5. PostgreSQL + Redis ─────────────────────────────────────────────
step "Database & cache"

ENV_VAL() { sed -n "s/^$1=//p" .env 2>/dev/null | head -1; }
DB_URL=$(ENV_VAL DATABASE_URL)
DB_URL=${DB_URL:-postgresql://kenyaairways:kenyaairways_dev@localhost:5432/kenyaairways}
DB_HOST=$(printf '%s' "$DB_URL" | sed -E 's#^postgresql://[^@]*@([^:/]+).*#\1#')
DB_PORT=$(printf '%s' "$DB_URL" | sed -E 's#^postgresql://[^@]*@[^:/]+:([0-9]+).*#\1#')
[ "$DB_PORT" = "$DB_URL" ] && DB_PORT=5432

tcp_up() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null && exec 3>&- 3<&- && return 0 || return 1; }
wait_for() { for _ in $(seq 1 60); do tcp_up "$1" "$2" && return 0; sleep 2; done; return 1; }

ensure_role() {
  # Best-effort: create the app role + database if they don't exist yet.
  local q="CREATE ROLE kenyaairways LOGIN PASSWORD 'kenyaairways_dev' CREATEDB;"
  local c="CREATE DATABASE kenyaairways OWNER kenyaairways;"
  sudo -u postgres psql -c "$q" >/dev/null 2>&1 || psql -U postgres -h "$DB_HOST" -c "$q" >/dev/null 2>&1 || true
  sudo -u postgres psql -c "$c" >/dev/null 2>&1 || psql -U postgres -h "$DB_HOST" -c "$c" >/dev/null 2>&1 || true
}

if tcp_up "$DB_HOST" "$DB_PORT"; then
  ok "PostgreSQL reachable on $DB_HOST:$DB_PORT"
  ensure_role
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  ok "starting PostgreSQL + Redis containers…"
  docker compose up -d db redis >/dev/null 2>&1 || fail "docker compose could not start the databases — check: docker compose up db redis"
  wait_for localhost 5432 || fail "the database container did not become ready"
  DB_HOST=localhost; DB_PORT=5432
  ok "databases up"
elif command -v apt-get >/dev/null 2>&1; then
  warn "installing PostgreSQL + Redis locally (sudo may ask for your password)…"
  sudo apt-get install -y postgresql redis-server >/dev/null
  sudo service postgresql start >/dev/null 2>&1 || sudo pg_ctlcluster "$(ls /etc/postgresql 2>/dev/null | head -1)" main start >/dev/null 2>&1 || true
  sudo service redis-server start >/dev/null 2>&1 || true
  DB_HOST=localhost
  ensure_role
  ok "PostgreSQL + Redis installed and started"
elif command -v brew >/dev/null 2>&1; then
  brew install postgresql@17 redis >/dev/null
  brew services start postgresql@17 >/dev/null 2>&1 || true
  brew services start redis >/dev/null 2>&1 || true
  DB_HOST=localhost
  ensure_role
  ok "PostgreSQL + Redis installed and started"
else
  fail "No PostgreSQL found. Install Docker (docker.com) or PostgreSQL 17, then run this file again."
fi

REDIS_PORT=$(printf '%s' "$(ENV_VAL REDIS_URL)" | sed -E 's#^redis://[^:/]+:([0-9]+).*#\1#')
REDIS_PORT=${REDIS_PORT:-6379}
if ! tcp_up localhost "$REDIS_PORT"; then
  if command -v redis-server >/dev/null 2>&1; then
    redis-server --daemonize yes --port "$REDIS_PORT" >/dev/null 2>&1 && ok "started local Redis"
  elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    docker compose up -d redis >/dev/null 2>&1 || true
  else
    warn "Redis not reachable — the API still runs, but seat holds and background jobs degrade until Redis is installed"
  fi
fi

# ── 6. schema + demo data ─────────────────────────────────────────────
step "Database schema"
pnpm db:push >/dev/null
ok "schema applied"

if [ "$SEED" = 1 ]; then
  step "Seeding the 114-airport worldwide network (first run ≈10 minutes)"
  pnpm db:seed
  ok "seed complete"
else
  warn "seeding skipped (--no-seed)"
fi

# ── 7. done ───────────────────────────────────────────────────────────
bold "✓ Setup complete"
# Bundle-aware listing: the traveller release ships apps/web, the admin
# release apps/admin (the full repo has both).
FRONT_LINE="  User app  →  http://localhost:3000"
ADMIN_LINE="  Admin     →  http://localhost:3001    (admin@kenyaairways.example / Password123!)"
[ -d apps/web ]    || FRONT_LINE=""
[ -d apps/admin ]  || ADMIN_LINE=""
if [ "$DEV" = 1 ]; then
  echo "  starting the apps — api :4100 (Ctrl-C to stop)"
  exec pnpm dev
fi
cat <<EOF

  Start everything:     ./start.sh          (Windows: double-click START.bat)
  or in a terminal:     pnpm dev

$FRONT_LINE
$ADMIN_LINE
  API       →  http://localhost:4100/api/v1    (Swagger: /api/docs)

  Upgrading later: download the new version (or git pull) and run this
  same script again — it upgrades the installation in place, keeping
  every booking, user and setting.
EOF
