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
| M7  | Seat map + assignment, check-in, boarding pass                      | ⬜      |
| M8  | Ops workspaces, KCAA manifest hooks, reporting                      | ⬜      |
| M9  | Kenya DPA (consent/export/delete/retention), i18n, hardening        | ⬜      |
| M10 | Load/concurrency tests, CI/CD, observability, docs                  | ⬜      |

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
docker compose up --build   # postgres, redis, api, web
```

### Without Docker (local services)

Point `.env` at your Postgres/Redis (the seed and tests work against any reachable
instance), then run `pnpm db:migrate && pnpm db:seed && pnpm dev`.

### Quality gates

```bash
pnpm verify        # prettier --check + eslint + tsc --noEmit + vitest (all workspaces)
```

### Seeded users

One user per role — `PASSENGER`, `AGENT`, `OPS`, `FINANCE`, `ADMIN` — at
`<role>@flight13.example`, password from `SEED_USER_PASSWORD` in `.env`
(default in `.env.example`: `Password123!`, dev-only).

---

## API surface

Base URL: `http://localhost:4000` · global prefix `/api/v1` · OpenAPI at `/api/docs`.

| Method | Path                                   | Purpose                                                                                                                                                                              | Auth                     |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| GET    | `/healthz`                             | Liveness (no dependencies)                                                                                                                                                           | public                   |
| GET    | `/readyz`                              | Readiness: Postgres + Redis (503 degraded)                                                                                                                                           | public                   |
| GET    | `/api/v1/meta`                         | Airline, IATA code, currencies, locales, timezone                                                                                                                                    | public                   |
| GET    | `/api/v1/airports`                     | Seeded airport directory (NBO/WIL/…/DXB)                                                                                                                                             | public                   |
| POST   | `/api/v1/auth/register`                | Create account + start session (terms consent)                                                                                                                                       | public                   |
| POST   | `/api/v1/auth/login`                   | Credentials → httpOnly session cookies                                                                                                                                               | public                   |
| POST   | `/api/v1/auth/refresh`                 | Rotate refresh token, mint access token                                                                                                                                              | refresh cookie           |
| POST   | `/api/v1/auth/logout`                  | Revoke token family, clear cookies                                                                                                                                                   | refresh cookie           |
| GET    | `/api/v1/auth/me`                      | Current session user                                                                                                                                                                 | access token             |
| POST   | `/api/v1/auth/otp/request`             | Send 6-digit OTP (SMS/email, rate-limited)                                                                                                                                           | public                   |
| POST   | `/api/v1/auth/otp/verify`              | Consume OTP                                                                                                                                                                          | public                   |
| GET    | `/api/v1/admin/users`                  | Paginated user directory                                                                                                                                                             | `ADMIN`                  |
| GET    | `/api/v1/flights/search`               | Date/route/pax search with priced fare options                                                                                                                                       | public                   |
| GET    | `/api/v1/flights/:id`                  | Flight detail                                                                                                                                                                        | public                   |
| GET    | `/api/v1/flights/:id/fares`            | Fare options + tax/fee breakdown (DB rules)                                                                                                                                          | public                   |
| GET    | `/api/v1/flights/:id/status`           | Live status + recent status timeline                                                                                                                                                 | public                   |
| POST   | `/api/v1/bookings`                     | Create booking: seat holds + TTL, pay to confirm                                                                                                                                     | access token             |
| GET    | `/api/v1/bookings` · `/bookings/:id`   | List / detail (owner or staff)                                                                                                                                                       | access token             |
| POST   | `/api/v1/bookings/:id/cancel`          | Cancel + release inventory                                                                                                                                                           | access token             |
| POST   | `/api/v1/bookings/:id/seats`           | Hold a specific seat (DB-unique active key)                                                                                                                                          | access token             |
| POST   | `/api/v1/payments`                     | Payment intent (idempotency key, starts STK)                                                                                                                                         | access token             |
| POST   | `/api/v1/payments/:id/stk`             | Re-initiate the provider attempt                                                                                                                                                     | access token             |
| GET    | `/api/v1/payments?bookingId=` · `/:id` | Payments for a booking / detail                                                                                                                                                      | access token             |
| POST   | `/api/v1/payments/:id/simulate`        | Deliver an STK result (mock mode only)                                                                                                                                               | access token             |
| POST   | `/api/v1/payments/:id/refund`          | Refund (FINANCE role + OTP step-up)                                                                                                                                                  | `FINANCE`                |
| POST   | `/api/v1/payments/cb/:secret/…`        | Neutral callbacks: `stk`, `c2b/*`, `stripe`                                                                                                                                          | secret + IP list         |
| GET    | `/api/v1/pnr/:code`                    | PNR lookup: booking + issued tickets                                                                                                                                                 | owner or staff           |
| POST   | `/api/v1/ticketing/issue`              | Issue e-tickets (idempotent, one per passenger)                                                                                                                                      | owner or staff           |
| WS     | `/rt`                                  | Socket.IO: `room.join`/`room.leave`/`ping` → `ack`, events `booking.updated`, `payment.updated`, `seat.*`, `flight.status.changed`, `notification.new` (+ replay via `sinceEventId`) | access token (handshake) |

**Session model:** access JWT (`f13_at`, 15 min) + rotating refresh JWT (`f13_rt`, 7 days),
both httpOnly/SameSite=Lax cookies (Bearer access token also accepted). Refresh reuse
revokes the whole token family; logout denies the family immediately via Redis, so access
tokens die before their TTL. Login is throttled per IP and locks the account after
`LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES`.

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
- **KCAA passenger manifest** delivery is an extension point (interface + hook), not wired
  to any government endpoint.
- **Payments** run in mock mode by default (`PAYMENT_PROVIDER_DEFAULT=MOCK`,
  `MPESA_MODE=mock`) — STK results arrive via `POST /payments/:id/simulate` or the neutral
  callback path with the secret from `.env`. Before live mode: **Stripe settlement in KES**
  and live Daraja **B2C refund completion** (recorded `PROCESSING`, closed manually today)
  need finance/ops sign-off.

---

## Testing

- `packages/shared` — pure unit tests (money, phone, PNR, state machine, M-Pesa codes)
- `apps/api` — Vitest (SWC for Nest decorator metadata), Supertest e2e against a real app
  instance; requires Postgres + Redis reachable per `.env`
- `apps/web` — Vitest for i18n/message parity; Playwright planned for M10
