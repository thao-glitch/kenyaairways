# Flight13

Real-time airline service platform for a Kenya-based licensed airline: search, book, pay
(M-Pesa Daraja + Stripe), issue PNRs, allocate seats, check in, and stream live status —
built as a pnpm monorepo.

| App / Package     | Stack                                                       |
| ----------------- | ----------------------------------------------------------- |
| `apps/web`        | Next.js (App Router) · TypeScript · Tailwind · shadcn/ui    |
| `apps/api`        | NestJS · REST + OpenAPI · Socket.IO · Prisma · BullMQ       |
| `packages/shared` | Money/phone/PNR/booking-state contracts shared by both apps |

**Default locale `en-KE`, secondary `sw-KE` · currency `KES` (integer minor units) ·
timezone `Africa/Nairobi` (stored UTC, displayed airport-local) · phones E.164 / MSISDN `254…`**

---

## Status — milestone tracker

| #   | Milestone                                                           | Status  |
| --- | ------------------------------------------------------------------- | ------- |
| M1  | Foundation: monorepo, schema, seed, health, meta, airports, swagger | ✅ done |
| M2  | Auth & access control (JWT, roles, MFA-ready OTP)                   | ✅ done |
| M3  | Flight inventory, search, fare rules                                | ✅ done |
| M4  | Booking lifecycle + seat holds                                      | ✅ done |
| M5  | Payments: M-Pesa STK/C2B, Stripe, refunds, reconciliation           | ✅ done |
| M6  | PNR, ticketing, real-time status (Socket.IO)                        | ✅ done |
| M7  | Seat map + assignment, check-in, boarding pass                      | ✅ done |
| M8  | Ops workspaces, KCAA manifest hooks, reporting                      | ✅ done |
| M9  | Kenya DPA (consent/export/delete/retention), i18n, hardening        | ✅ done |
| M10 | Load/concurrency tests, CI/CD, observability, docs                  | ✅ done |

---

## Quick start

Prerequisites: Node ≥ 22, pnpm 10, and **either** Docker **or** local Postgres + Redis.

```bash
pnpm install          # installs workspace deps
pnpm bootstrap        # generates .env with random secrets (never commit .env)
pnpm db:migrate       # applies Prisma migrations
pnpm db:seed          # airports, aircraft, seat maps, fares, 30 days of flights, users
pnpm dev              # api on :4000, web on :3000
```

`pnpm bootstrap` also creates the `apps/api/.env` → root `.env` symlink Prisma CLI needs.

### With Docker

```bash
docker compose up --build   # postgres, redis, api (migrate → seed → serve), web
```

The API container migrates, seeds (idempotent) and serves in one command; secrets come
from the generated root `.env`, and mock payment/SMS providers are selected there. The
compose file raises `RATE_LIMIT_MAX` for load tests — keep the `.env.example` defaults
outside this stack.

### Without Docker (local services)

Point `.env` at your Postgres/Redis (the seed and tests work against any reachable
instance), then run `pnpm db:migrate && pnpm db:seed && pnpm dev`.

### Quality gates

```bash
pnpm verify        # prettier --check + eslint + tsc --noEmit + vitest (all workspaces)
```

### Verify the full journey

With the stack running and the seed applied:

1. Search on `/flights` (e.g. NBO → MBA, tomorrow) → open a flight → **Select** a fare.
2. Register or sign in — cookies are httpOnly; the client refreshes them silently.
3. Submit the booking form → `/bookings/:id`: seats held with a live countdown and a
   Socket.IO connection (polling fallback when offline).
4. Pay with M-Pesa (mock mode: **Simulate: success**) → the booking turns **Confirmed**.
5. **Issue tickets** → **Check in now** → open the **Boarding pass**: seat, sequence,
   airport-local times and the printable 54-char IATA BCBP payload.
6. Live status: `booking:{id}` / `flight:{id}` / `seat.*` events stream into the hub
   without a reload.

### Seeded users

One user per role — `PASSENGER`, `AGENT`, `OPS`, `FINANCE`, `ADMIN` — at
`<role>@flight13.example`, password from `SEED_USER_PASSWORD` in `.env`
(default in `.env.example`: `Password123!`, dev-only).

---

## API surface

Base URL: `http://localhost:4000` · global prefix `/api/v1` · OpenAPI at `/api/docs`.

| Method | Path                                          | Purpose                                                                                                                                                                                                                            | Auth                      |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| GET    | `/healthz`                                    | Liveness (no dependencies)                                                                                                                                                                                                         | public                    |
| GET    | `/readyz`                                     | Readiness: Postgres + Redis (503 degraded)                                                                                                                                                                                         | public                    |
| GET    | `/metrics`                                    | Prometheus text metrics: request counts + latency histograms per route template                                                                                                                                                    | public (scrapers)         |
| GET    | `/api/v1/meta`                                | Airline, IATA code, currencies, locales, timezone                                                                                                                                                                                  | public                    |
| GET    | `/api/v1/airports`                            | Seeded airport directory (NBO/WIL/…/DXB)                                                                                                                                                                                           | public                    |
| POST   | `/api/v1/auth/register`                       | Create account + start session (terms consent)                                                                                                                                                                                     | public                    |
| POST   | `/api/v1/auth/login`                          | Credentials → httpOnly session cookies                                                                                                                                                                                             | public                    |
| POST   | `/api/v1/auth/refresh`                        | Rotate refresh token, mint access token                                                                                                                                                                                            | refresh cookie            |
| POST   | `/api/v1/auth/logout`                         | Revoke token family, clear cookies                                                                                                                                                                                                 | refresh cookie            |
| GET    | `/api/v1/auth/me`                             | Current session user                                                                                                                                                                                                               | access token              |
| POST   | `/api/v1/auth/otp/request`                    | Send 6-digit OTP (SMS/email, rate-limited)                                                                                                                                                                                         | public                    |
| POST   | `/api/v1/auth/otp/verify`                     | Consume OTP                                                                                                                                                                                                                        | public                    |
| GET    | `/api/v1/admin/users`                         | Paginated user directory                                                                                                                                                                                                           | `ADMIN`                   |
| GET    | `/api/v1/flights/search`                      | Date/route/pax search with priced fare options                                                                                                                                                                                     | public                    |
| GET    | `/api/v1/flights/:id`                         | Flight detail                                                                                                                                                                                                                      | public                    |
| GET    | `/api/v1/flights/:id/fares`                   | Fare options + tax/fee breakdown (DB rules)                                                                                                                                                                                        | public                    |
| GET    | `/api/v1/flights/:id/status`                  | Live status + recent status timeline                                                                                                                                                                                               | public                    |
| GET    | `/api/v1/flights/:id/seats`                   | Seat map with live hold/sold state                                                                                                                                                                                                 | public                    |
| POST   | `/api/v1/bookings`                            | Create booking: seat holds + TTL, pay to confirm                                                                                                                                                                                   | access token              |
| GET    | `/api/v1/bookings` · `/bookings/:id`          | List / detail (owner or staff)                                                                                                                                                                                                     | access token              |
| POST   | `/api/v1/bookings/:id/cancel`                 | Cancel + release inventory                                                                                                                                                                                                         | access token              |
| POST   | `/api/v1/bookings/:id/seats`                  | Hold a specific seat (DB-unique active key)                                                                                                                                                                                        | access token              |
| POST   | `/api/v1/payments`                            | Payment intent (idempotency key, starts STK)                                                                                                                                                                                       | access token              |
| POST   | `/api/v1/payments/:id/stk`                    | Re-initiate the provider attempt                                                                                                                                                                                                   | access token              |
| GET    | `/api/v1/payments?bookingId=` · `/:id`        | Payments for a booking / detail                                                                                                                                                                                                    | access token              |
| POST   | `/api/v1/payments/:id/simulate`               | Deliver an STK result (mock mode only)                                                                                                                                                                                             | access token              |
| POST   | `/api/v1/payments/:id/refund`                 | Refund (FINANCE role + OTP step-up)                                                                                                                                                                                                | `FINANCE`                 |
| POST   | `/api/v1/payments/cb/:secret/…`               | Neutral callbacks: `stk`, `c2b/*`, `stripe`                                                                                                                                                                                        | secret + IP list          |
| GET    | `/api/v1/pnr/:code`                           | PNR lookup: booking + issued tickets                                                                                                                                                                                               | owner or staff            |
| POST   | `/api/v1/ticketing/issue`                     | Issue e-tickets (idempotent, one per passenger)                                                                                                                                                                                    | owner or staff            |
| POST   | `/api/v1/check-in`                            | Check passengers in + issue boarding passes (window enforced, idempotent)                                                                                                                                                          | access token              |
| GET    | `/api/v1/check-in?bookingId=`                 | Check-in status + boarding pass ids for a booking                                                                                                                                                                                  | access token              |
| GET    | `/api/v1/boarding-passes/:id`                 | One boarding pass incl. IATA BCBP payload (54-char M1)                                                                                                                                                                             | owner or staff            |
| PATCH  | `/api/v1/ops/flights/:id/status`              | Ops: status/gate/delay update — transition-checked, timeline + audit + real-time                                                                                                                                                   | `OPS` or `ADMIN`          |
| GET    | `/api/v1/ops/manifests?flightId=`             | Ops: passenger manifest for one flight (ticketed travellers)                                                                                                                                                                       | `OPS` or `ADMIN`          |
| POST   | `/api/v1/ops/manifests/:flightId/dispatch`    | Dispatch the manifest through the KCAA hook (async, audited, retried)                                                                                                                                                              | `OPS` or `ADMIN`          |
| GET    | `/api/v1/ops/dispatches?flightId=`            | Recent manifest dispatch attempts (status, attempts, digest)                                                                                                                                                                       | `OPS` or `ADMIN`          |
| GET    | `/api/v1/reports/revenue?from=&to=&currency=` | Daily gross/refund/net by **Nairobi** calendar day                                                                                                                                                                                 | `FINANCE` or `ADMIN`      |
| GET    | `/api/v1/reports/load?from=&to=&origin=`      | Capacity vs sold per flight — load factor                                                                                                                                                                                          | `FINANCE`, `OPS`, `ADMIN` |
| GET    | `/api/v1/me/consents`                         | Consent history — append-only ledger (Kenya DPA)                                                                                                                                                                                   | access token              |
| POST   | `/api/v1/me/consents`                         | Record a consent grant or withdrawal (never rewrites history)                                                                                                                                                                      | access token              |
| GET    | `/api/v1/me/dsar`                             | Own data subject request history (export/erasure)                                                                                                                                                                                  | access token              |
| POST   | `/api/v1/me/dsar`                             | File a DSAR: `EXPORT` returns the full copy inline with a `sha256:` digest, `DELETE` erases PII (bookings unlinked, kept for the statutory window)                                                                                 | access token              |
| WS     | `/rt`                                         | Socket.IO: `room.join`/`room.leave`/`ping` → `ack`, events `booking.updated`, `payment.updated`, `seat.*`, `flight.status.changed`, `gate.changed`, `delay.updated`, `ops.alert`, `notification.new` (+ replay via `sinceEventId`) | access token (handshake)  |

**Session model:** access JWT (`f13_at`, 15 min) + rotating refresh JWT (`f13_rt`, 7 days),
both httpOnly/SameSite=Lax cookies (Bearer access token also accepted). Refresh reuse
revokes the whole token family; logout denies the family immediately via Redis, so access
tokens die before their TTL. Login is throttled per IP and locks the account after
`LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES`. The web client rotates silently:
on a 401 it calls `POST /auth/refresh` once (shared in-flight promise per tab) and
retries the request.

---

## Repository layout

```
apps/api        NestJS API, Prisma schema/migrations/seed, e2e tests
apps/web        Next.js web app (mobile-first, EN/SW)
packages/shared Zod-safe shared contracts: money, phone, PNR, booking-state machine,
                M-Pesa result codes, WS event catalog, API DTOs
docs/           Architecture and milestone documentation
scripts/        bootstrap (.env generator)
```

Full design docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Configuration

All configuration is validated at boot with Zod — the process refuses to start on a
missing/invalid value. `.env.example` documents every key; secrets are generated by
`pnpm bootstrap` (`JWT_*`, `ENCRYPTION_KEY`, `MPESA_CALLBACK_SECRET`, …).

**No hard-coded secrets live in this repository.**

### Flags for finance/compliance review

- **Tax & fee rules** in the database (`TaxRule`) are _configurable per route type_, but the
  seeded values are placeholders — **finance must confirm** actual KAA/KCAA taxes, service
  fees, and VAT before go-live.
- **M-Pesa callback path** is neutral (`/api/v1/payments/cb/<secret>/…`) — no provider names
  in registered URLs; the callback secret is a path token because Safaricom does not sign
  callbacks (IP allowlist + payload validation are enforced at the endpoint).
- **KCAA passenger manifest** delivery runs through a `ManifestDispatcher` hook:
  `POST /ops/manifests/:flightId/dispatch` records an audit row and hands the HTTP call to
  a BullMQ worker (3 attempts). With `KCAA_MANIFEST_URL` unset (default) the no-op
  dispatcher records `SKIPPED` — nothing leaves the process; **no government endpoint is
  wired by default**.
- **Payments** run in mock mode by default (`PAYMENT_PROVIDER_DEFAULT=MOCK`,
  `MPESA_MODE=mock`) — STK results arrive via `POST /payments/:id/simulate` or the neutral
  callback path with the secret from `.env`. Before live mode: **Stripe settlement in KES**
  and live Daraja **B2C refund completion** (recorded `PROCESSING`, closed manually today)
  need finance/ops sign-off.
- **Kenya DPA 2019** flows live under `/api/v1/me/*`: consent is an append-only ledger,
  `POST /me/dsar` serves access/export (full copy + `sha256:` digest, inline — there is no
  object store) and erasure (account scrubbed to a DISABLED shell, bookings unlinked but
  retained). Retention is enforced by a daily BullMQ sweep: audit logs/notifications are
  deleted after `DATA_RETENTION_LOG_DAYS` (default 365), terminal bookings keep their
  financial record but lose passenger PII after `DATA_RETENTION_BOOKING_DAYS` (default
  2555 ≈ 7 years) — **compliance must confirm both windows and the statutory basis**.
- **SMS delivery** is pluggable via `SMS_PROVIDER`: `mock` (default, logs only),
  `africastalking` or `twilio` (credentials required by Zod when selected). OTPs, ticket
  issue and check-in render localized (en/sw) templates; the ticketing/check-in notices
  mirror in-app notifications by SMS when the booking has an MSISDN.

---

## Testing

- `packages/shared` — pure unit tests (money, phone, PNR, state machine, M-Pesa codes)
- `apps/api` — Vitest (SWC for Nest decorator metadata), Supertest e2e against a real app
  instance; requires Postgres + Redis reachable per `.env`
- `apps/web` — Vitest for formatting/timezone helpers, i18n/message parity; Playwright
  for the full passenger journey (`e2e/passenger-flow.spec.ts`: search → book → pay →
  PNR → seat → check-in → boarding pass against a running stack)

### Soak / load

```bash
pnpm soak                                  # against http://localhost:4000
SOAK_USERS=10 SOAK_DURATION_S=60 pnpm soak # more heat
```

`scripts/soak.mjs` is dependency-free: N virtual users loop the real journey
(search → book → mock STK → confirm → issue) for the duration, then the run **fails**
unless the error rate stays ≤ `SOAK_MAX_ERROR_PCT` (1%) and overall p95 ≤
`SOAK_MAX_P95_MS` (2000ms). CI runs it against the freshly composed stack after the
build, before Playwright.
