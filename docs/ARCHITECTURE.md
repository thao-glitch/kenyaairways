# Flight13 — Architecture

Companion to the [README](../README.md). Paths, contracts, and diagrams here are the
source of truth for implementation; where an earlier design note disagrees (for example the
M-Pesa callback path), this document wins.

## 1. System overview

```
                       ┌──────────────────────────────┐
  browser ──HTTPS────▶ │  apps/web  (Next.js :3000)   │  App Router, mobile-first,
                       │  server + client components  │  EN/SW, cookie locale
                       └──────────────┬───────────────┘
                                      │ REST /api/v1  +  Socket.IO /rt
                       ┌──────────────▼───────────────┐
                       │  apps/api   (NestJS :4000)   │
                       │  controllers → services      │
                       │  BullMQ workers · guards     │
                       └───┬──────────┬──────────┬────┘
                           │          │          │
                     Prisma│     Redis│          │ outbound
                           ▼          ▼          ▼
                     Postgres      Redis     Daraja (M-Pesa),
                     (source of    (cache,   Stripe, Africa's
                      truth)       queues,   Talking SMS,
                                   rate-     (mock via env flag)
                                   limits)
```

- **Monorepo**: pnpm workspaces — `apps/web`, `apps/api`, `packages/shared`.
- **`packages/shared`** holds every cross-app contract: money math, phone/MSISDN, PNR
  checksum, the booking-state transition table, M-Pesa result codes, WS event catalog,
  and API DTO types. No app re-implements these.
- **Config** is a single Zod-validated module (`apps/api/src/config/env.ts`). Boot fails
  loudly on invalid config; nothing reads `process.env` anywhere else.

## 2. Folder structure

```
apps/api
├── src
│   ├── config/env.ts            Zod env contract + loader (only place env is read)
│   ├── common/                  logger (PII masking), AES-GCM crypto, blind index,
│   │                            Nest↔structured-logger bridge
│   ├── prisma/                  PrismaModule (global), PrismaService ($connect/ping)
│   ├── redis/                   RedisModule (global), RedisService (ioredis)
│   ├── app.module.ts            module graph
│   ├── app.setup.ts             shared configureApp() used by main.ts AND e2e tests
│   ├── main.ts                  bootstrap (fatal-error logging)
│   └── modules/                 one folder per bounded context
│       ├── health/              /healthz /readyz
│       ├── meta/                /api/v1/meta
│       └── flights/             /api/v1/airports (search lands here in M3)
├── prisma/schema.prisma         34 models, 29 enums
├── prisma/migrations/
├── prisma/seed.ts               idempotent, re-runnable
└── test/                        Vitest + Supertest e2e

apps/web
└── src
    ├── app/                     App Router: layout, page, loading, not-found, actions
    ├── components/              site chrome + shadcn-style ui primitives
    ├── lib/                     env, fetch client, i18n, cn()
    └── messages/{en,sw}.json    locale bundles (parity-tested)

packages/shared/src
└── constants · domain · money · phone · pnr · time · booking-state ·
    mpesa-codes · errors · i18n · ws-events · api-contracts
```

## 3. Data model (ER)

```mermaid
erDiagram
    User ||--o{ RefreshToken : owns
    User ||--o{ OtpCode : receives
    User ||--o{ ConsentRecord : grants
    User ||--o{ DataSubjectRequest : files
    User ||--o| PassengerProfile : has
    User ||--o{ Booking : books
    PassengerProfile ||--o{ BookingPassenger : fills

    Airport ||--o{ FlightSchedule : serves
    AircraftType ||--o{ Aircraft : instantiates
    Aircraft ||--o{ Flight : operates
    SeatMap ||--o{ Seat : contains
    AircraftType ||--o| SeatMap : uses
    FlightSchedule ||--o{ Flight : instantiates
    Flight ||--o{ FlightStatusEvent : emits
    Flight ||--o{ Inventory : sells
    Flight ||--o{ BookingSegment : carries
    Flight ||--o{ Fare : prices

    FareClass ||--o{ Fare : prices
    FareClass ||--o{ FareRule : restricts
    TaxFeeRule ||--o| Fare : taxes

    Booking ||--o{ BookingSegment : contains
    Booking ||--o{ BookingPassenger : carries
    Booking ||--o{ Payment : pays
    Booking ||--o{ SeatHold : holds
    BookingPassenger ||--o{ Ticket : issues
    BookingPassenger ||--o{ CheckIn : checks_in
    BookingPassenger ||--o{ BookingAncillary : buys
    BookingPassenger ||--o{ Baggage : checks
    BookingAncillary ||--o{ Seat : reserves
    SeatHold ||--o| Seat : reserves
    CheckIn ||--o| BoardingPass : produces

    Payment ||--o{ MpesaTransaction : stk
    Payment ||--o{ MpesaC2BPayment : c2b
    Payment ||--o{ Refund : refunds
    User ||--o{ AuditLog : actions
    User ||--o{ Notification : notified
```

### Key modeling decisions

| Decision                                                                 | Rationale                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| All money is **integer minor units** (`Int`) + `Currency`                | No float drift; `formatKes()` renders `KES 12,500`                                              |
| All timestamps `DateTime` stored **UTC**, display via airport tz         | Nairobi default `Africa/Nairobi`; DXB/LHR shown local                                           |
| `Flight` is the sellable instance of `FlightSchedule` + date             | Inventory, fares, and status hang off the instance                                              |
| `Inventory` row per `(flight, fareClass)` with `seatsAvailable`          | Updated with row-level locking — no double-booking (M4)                                         |
| `SeatHold` with `HoldStatus` + TTL (Redis `SETEX` mirror)                | Atomic hold→book; expiry sweeps via BullMQ                                                      |
| `Payment` is the intent; provider records hang off it                    | One provider interface, many backends, one audit trail                                          |
| PII (passport/ID) **AES-256-GCM encrypted** + **blind index** for lookup | Kenya DPA 2019: minimise, encrypt, be able to delete                                            |
| `AuditLog` append-only, `StatusSource` on every status change            | KCAA + dispute trail                                                                            |
| Tax/fee rules are **DB rows** (`TaxFeeRule`, per route type)             | Finance can reconfigure without a deploy — **values are placeholders pending finance sign-off** |

## 4. API surface

Global prefix `/api/v1` (probes `/healthz`, `/readyz` are deliberately outside it).
OpenAPI served at `/api/docs` (disabled when `ENABLE_SWAGGER=false`).

**Implemented (M1)**

| Method | Path               | Notes                                |
| ------ | ------------------ | ------------------------------------ |
| GET    | `/healthz`         | liveness, no deps                    |
| GET    | `/readyz`          | 503 when Postgres/Redis down         |
| GET    | `/api/v1/meta`     | airline, currency, locales, timezone |
| GET    | `/api/v1/airports` | airport directory                    |

**Planned (by milestone)**

| Milestone | Endpoints                                                                                                                                                                                                                                    |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M2        | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/otp/verify`, `GET /me`, `POST /admin/users`, role guards                                                                                   |
| M3        | `GET /flights/search`, `GET /flights/:id`, `GET /flights/:id/fares`, `GET /fare-classes`                                                                                                                                                     |
| M4        | `POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/hold-seat`, `DELETE /bookings/:id/seats/:seatId`, `POST /bookings/:id/expire`                                                                                                     |
| M5        | `POST /payments` (provider select), `POST /payments/:id/stk`, `POST /payments/cb/:secret/stk`, `POST /payments/cb/:secret/c2b/validate`, `POST /payments/cb/:secret/c2b/confirm`, `GET /payments/:id`, `POST /payments/:id/refund` (FINANCE) |
| M6        | `GET /pnr/:code`, `POST /ticketing/issue`, `GET /flights/:id/status`, ops status endpoints                                                                                                                                                   |
| M7        | `GET /flights/:id/seats`, `POST /check-in`, `GET /boarding-passes/:id`                                                                                                                                                                       |
| M8        | `GET /ops/manifests`, `POST /ops/manifests/:id/dispatch` (KCAA hook), `GET /reports/*`                                                                                                                                                       |
| M9        | `GET/POST /me/consents`, `POST /me/dsar` (access/export/delete), retention jobs                                                                                                                                                              |

## 5. Real-time catalog (Socket.IO, namespace `/rt`)

Rooms: `user:{id}`, `booking:{id}`, `flight:{id}` (see `packages/shared/src/ws-events.ts`).

| Event                               | Room    | Payload gist                                   |
| ----------------------------------- | ------- | ---------------------------------------------- |
| `booking.status`                    | booking | state-machine transition, actor, timestamp     |
| `booking.expiring`                  | booking | seconds left on unpaid hold                    |
| `payment.status`                    | booking | intent status + typed M-Pesa result code       |
| `flight.status`                     | flight  | `FlightStatus` + `StatusSource`                |
| `seat.taken`                        | flight  | seat id removed from map (conflict resolution) |
| `checkin.opened` / `checkin.closed` | flight  | window changes                                 |
| `notify`                            | user    | i18n message key + params (SMS mirrors it)     |

Auth: JWT from the same access token as REST, validated on the handshake.

## 6. Payments

Provider selection is a typed interface (`PaymentProvider`) with implementations
`DarajaStkProvider`, `DarajaC2BProvider`, `StripeProvider`, `MockProvider` — chosen by
`MPESA_MODE` / `STRIPE_MODE` env (mock by default, no network calls in dev/CI).

**Callback path (authoritative):** `POST /api/v1/payments/cb/:secret/…` — neutral path,
no `mpesa`/`safaricom` strings in the registered URL. `:secret` is `MPESA_CALLBACK_SECRET`
(a path token, since Safaricom does not sign callbacks) and the endpoint additionally
enforces source-IP allowlist + strict payload validation. _(Design note: an earlier sketch
said `/api/payments/cb/…`; the `/api/v1` prefix above is what ships.)_

### STK Push sequence

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant Q as BullMQ
    participant D as Daraja
    C->>A: POST /payments {provider: MPESA_STK, bookingId}
    A->>A: create Payment intent (PENDING), audit log
    A->>D: OAuth token (cached in Redis until expiry)
    A->>D: STK Push<br/>Password=base64(Shortcode+Passkey+Timestamp)<br/>AccountReference=PNR(≤12), Desc="Flight13"
    D-->>A: CheckoutRequestID
    A->>A: persist MpesaTransaction (PENDING)
    A-->>C: 202 {checkoutRequestId} (fast)
    D-->>A: POST /api/v1/payments/cb/:secret/stk (async)
    A-->>D: 200 {"ResultCode":0,...}  (ack immediately)
    A->>Q: enqueue handle-stk-callback (idempotent on CheckoutRequestID)
    Q->>A: map ResultCode 0/1/1032/1037/2001 → typed message
    A->>A: single transactional confirm (guard: already CONFIRMED?) → Payment CONFIRMED, Booking → PAID
    A-->>C: WS payment.status + booking.status
```

Late/duplicate callbacks re-enter the same idempotent job and never double-confirm.

### C2B confirmation sequence

```mermaid
sequenceDiagram
    participant D as Daraja
    participant A as API
    participant Q as BullMQ
    D->>A: POST .../c2b/validate
    A-->>D: 200 {"ResultCode":0} accepted (or rejection code)
    D->>A: POST .../c2b/confirm
    A-->>D: 200 fast ack
    A->>Q: enqueue reconciliation job (~60–90s)
    Q->>A: match by account code (PNR) → over/under/late/unknown-account paths
    A->>A: Payment CONFIRMED | HOLD for FINANCE | unmatched → audit + alert
```

Refunds require a `FINANCE` role approval before dispatch; every transition is audited and
logged with PII masked.

## 7. Security & compliance

- **Auth**: JWT access (15 min) + rotating refresh in httpOnly cookies; roles
  `PASSENGER · AGENT · OPS · FINANCE · ADMIN`; login throttling + OTP (SMS) hooks.
- **Transport**: helmet, CORS allowlist from env, rate limits (global + stricter auth).
- **Secrets**: only from Zod-validated env; `.env` is git-ignored and generated by
  `pnpm bootstrap`.
- **PII**: encrypted at rest, blind-indexed for lookup, masked in every log line; DPA 2019
  consent records, data-subject access/export/delete requests, retention policy (M9).
- **KCAA manifest** dispatch is an interface (`ManifestDispatcher`) with a no-op default —
  a government endpoint can be plugged in without touching booking code.

## 8. Milestone plan

| #   | Scope                                                        | Exit criteria                                    |
| --- | ------------------------------------------------------------ | ------------------------------------------------ |
| M1  | Monorepo, schema + seed, health/meta/airports, swagger, docs | `pnpm verify` green; API boots; seed re-runnable |
| M2  | Auth, roles, guards, OTP, refresh rotation                   | login → refresh → logout e2e; RBAC tests         |
| M3  | Search, fares, tax application                               | search returns priced options incl. taxes        |
| M4  | Booking + seat holds                                         | concurrency test proves no double-booking        |
| M5  | Payments (STK, C2B, Stripe, refunds, recon)                  | duplicate/lost callbacks never double-confirm    |
| M6  | PNR, ticketing, Socket.IO status                             | real-time propagation test                       |
| M7  | Seats, check-in, boarding pass                               | full search→book→pay→check-in flow green         |
| M8  | Ops workspace, KCAA hooks, reporting                         | manifest hook unit-tested with fake endpoint     |
| M9  | DPA flows, i18n, hardening                                   | export/delete tests; SW translations complete    |
| M10 | Load, CI/CD polish, Playwright, observability                | CI runs verify + docker build; soak test         |

Each milestone ends with lint + typecheck + tests green and a conventional commit.
