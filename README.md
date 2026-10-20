# ✈ Kenya Airways

A complete, self-contained airline booking platform: a passenger app, a staff
admin app, and a production-grade API with PostgreSQL and Redis. The network
covers **all seven continents — 114 airports** — and every flight search
returns bookable results for **any city pair on any day** (the timetable
materialises routes on demand).

| App                          | Port | What it is                                                                                                         |
| ---------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------ |
| **User app** (`apps/web`)    | 3000 | Booking, manage trips, check-in, flight status, rewards, travel inspiration — installable on phones & desktops     |
| **Admin app** (`apps/admin`) | 3001 | Staff operations: bookings, departures, revenue, site appearance (rename the airline, replace any photo by upload) |
| **API** (`apps/api`)         | 4100 | NestJS + Prisma REST API (OpenAPI/Swagger at `/api/docs`), JWT auth, M-Pesa & Stripe demo payments, i18n EN+SW     |

---

## Quick start — one file installs everything

**Download** the repo (GitHub → green _Code_ → _Download ZIP_, or
`git clone`), unzip it, and **double-click — it installs itself, no
navigation through files needed**:

| System      | Double-click                    |
| ----------- | ------------------------------- |
| **Windows** | `INSTALL.bat`                   |
| **macOS**   | `INSTALL.command`               |
| **Linux**   | `Install Kenya Airways.desktop` |

**Linux note (Kali, XFCE, Debian, Ubuntu):** the `.desktop` launcher is
the one to double-click. Your file manager may show a one-time security
prompt before running any downloaded program — that is normal Linux
behaviour, not an error:

- **Thunar** (Kali/XFCE) → _Execute_ / _Trust and Launch_
- **Nautilus** (Ubuntu/GNOME) → _Trust and Launch_ / _Run as a program_
- **Dolphin** (Kali KDE) → _Run_ / _Mark as executable_

It appears once; after that the launcher double-clicks straight into the
installer. (If your file manager opens `INSTALL.sh` as text instead, use
the `.desktop` launcher above — that is exactly what it is for.)

The installer takes it from there — no prerequisites needed:

- installs **Node.js + pnpm** if missing (Windows silently via winget;
  Linux/macOS via apt/brew)
- installs the workspace and generates fresh secrets into `.env`
  (never overwritten on later runs)
- starts **PostgreSQL + Redis** — via Docker when present, otherwise it
  installs and starts a local server itself
- applies the database schema and **seeds the 114-airport worldwide
  network** (first run ≈ 10 minutes)

Then **double-click `START.bat`** (Windows), **`Start.command`**
(macOS) or **`Start Kenya Airways.desktop`** (Linux) — the whole
platform comes up and your browser opens:

- **http://localhost:3000** — user app
- **http://localhost:3001** — admin (`admin@kenyaairways.example` / `Password123!`)
- **http://localhost:4100/api/docs** — API Swagger

Prefer terminals? `./setup.sh --dev` does install + start in one go.
Already in VS Code? Terminal → _Run Task…_ → **start: all apps**.

### Already installed? The same file upgrades you

Download the new version (or `git pull`) and **run the same installer
again** — it detects the existing installation and upgrades it **in
place**: refreshes dependencies, pulls the latest code, pushes the schema
forward and re-applies network updates. Every booking, user, setting and
photo upload is preserved. From a ZIP (no git) it upgrades without
pulling.

### Docker alternative (stack in containers)

```bash
./setup.sh                              # creates .env with generated secrets
docker compose up -d --build            # db + redis + api + web + admin
docker compose run --rm api pnpm db:seed   # first run only: seed the network
```

### Demo accounts

| Role                                     | Login                                         |
| ---------------------------------------- | --------------------------------------------- |
| Admin                                    | `admin@kenyaairways.example` / `Password123!` |
| Agent, finance, ops, sysadmin, passenger | seeded — see `apps/api/prisma/seed.ts`        |

Demo payments use M-Pesa “Payment number **0182774255**” (manual-verification
demo mode — the Daraja STK flow is intentionally untouched). Change
`SEED_USER_PASSWORD` and all secrets before any real deployment.

---

## Install it on any device (phone, tablet, desktop)

The user app is a **PWA** — browsers offer it as a real app:

| Platform                            | How                                                         |
| ----------------------------------- | ----------------------------------------------------------- |
| **Android** (Chrome/Edge/Samsung)   | Open the site → menu → **Add to Home screen / Install app** |
| **iPhone / iPad** (Safari)          | Share → **Add to Home Screen**                              |
| **Windows** (Edge/Chrome)           | Address-bar **Install** button, or menu → Apps → Install    |
| **macOS** (Safari/Chrome)           | File → Install / Save to Dock, or Add to Home Screen        |
| **Linux** (Chrome/Firefox/Chromium) | Menu → **Install Kenya Airways** / Save to Web Applications |

It launches full-screen with the airline icon, works offline for cached pages,
and updates itself automatically whenever the server updates (just refresh).

### Shipping it to the Play Store / app stores

1. Run the app on a public HTTPS URL.
2. Feed that URL into **[PWABuilder](https://www.pwabuilder.com)** → it wraps
   the same PWA into an Android **TWA** (Play Store) or iOS package.
3. Follow its signing/publish steps (Play Console or App Store Connect).

No separate mobile codebase is needed — this repo _is_ the mobile app.

---

## Configuration

The installer generates `.env` at the repo root with safe defaults and
fresh secrets (the API reads the nearest `.env`; `apps/api/.env` is
linked to it for the Prisma CLI). The full annotated list of every
variable is in [`.env.example`](.env.example). Highlights:

- `AIRLINE_NAME` — rebrand instantly (also live-editable in Admin → Appearance)
- `DATABASE_URL`, `REDIS_URL`
- `JWT_*`, `SESSION_COOKIE_SECRET`, `ENCRYPTION_KEY`, `MPESA_CALLBACK_SECRET`
  — generated by setup.sh; rotate for production
- `MPESA_*`, `STRIPE_*`, SMS/email providers — demo values work out of the box;
  plug in live credentials to go live

The airline name, theme, and every photo on both apps are editable at runtime
in **Admin → Appearance** (images are replaced by file upload, never URLs).

## Upgrading

Run **the same installer you ran the first time** — that is the whole
upgrade flow:

- **Windows**: download/unzip the new version over the old folder (or
  `git pull` inside it) → double-click `INSTALL.bat`
- **Linux / macOS**: `git pull && ./setup.sh` (or run `setup.sh` from a
  fresh download in the same folder)
- **Docker**: `git pull && docker compose up -d --build`

Your data survives every upgrade: `prisma db push` is additive, the
network seed is upserted, and `.env` (with your secrets) is never
overwritten. Skip the git pull with `SKIP_PULL=1 ./setup.sh` when
upgrading from a ZIP.

## Production hardening checklist

- [ ] Rotate every secret (they are generated per-install, never committed)
- [ ] Put the API behind HTTPS and set `CORS_ORIGINS` to your real domains
- [ ] Set live `MPESA_*` / `STRIPE_*` keys, or disable those providers
- [ ] Point `NEXT_PUBLIC_API_URL` / `API_PUBLIC_URL` build args at your API domain
- [ ] Restrict admin (`:3001`) with a firewall / SSO — it is staff-only
- [ ] Turn off Swagger (`ENABLE_SWAGGER=0`) if you don't want public docs

## Repository layout

```
apps/web        Passenger app (Next.js App Router, EN+SW i18n, PWA)
apps/admin      Staff app (Next.js, role-gated)
apps/api        NestJS + Prisma REST API, OpenAPI, background jobs
packages/shared Shared DTOs & contracts consumed by all three
INSTALL.bat / INSTALL.command / INSTALL.sh
Install Kenya Airways.desktop  Double-click installers — Windows / macOS / Linux (first install & in-place upgrades)
START.bat / Start.command / Start Kenya Airways.desktop
start.sh                       Double-click launchers for the whole platform
.vscode/tasks.json       “setup / start / seed” tasks inside VS Code
docker-compose.yml       Entire stack in containers
```

## License

[MIT](LICENSE) — free to use, modify and hand over.
