/**
 * SQLite schema for the on-device offline world.
 *
 * Mirrors the Postgres schema at a smaller grain: the same tables the API
 * uses (users, schedules, flights, fares, inventory, bookings, seat holds,
 * tickets, check-ins, boarding passes, payments, M-Pesa verification records)
 * so engine code reads almost 1:1 like the NestJS services. Column names are
 * camelCase to match Prisma's output shape.
 *
 * Static reference data (airports, aircraft types + seat templates, fare
 * classes, tax rules, schedules) is seeded once from the JSON exported from
 * the dev database — see `world.ts` / `apps/api/scripts/export-mobile-seed.ts`.
 */
import type { SqlDb } from './db';
import { kvGet, kvSet } from './kv';

const DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ── identity ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  passwordHash TEXT NOT NULL,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL,
  locale TEXT NOT NULL,
  timezone TEXT,
  emailVerified INTEGER NOT NULL DEFAULT 0,
  phoneVerified INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

-- Single row: the identity + token pair this device last authenticated with
-- (local OR remote login) so /auth/me keeps working with the PC backend down.
CREATE TABLE IF NOT EXISTS local_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  user_json TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- ── reference data (seeded from refdata.json) ───────────────────────────────
CREATE TABLE IF NOT EXISTS airports (
  code TEXT PRIMARY KEY,
  icao TEXT,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  countryCode TEXT NOT NULL,
  timezone TEXT NOT NULL,
  continent TEXT NOT NULL,
  routeType TEXT NOT NULL,
  domestic INTEGER NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS aircraft_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  manufacturer TEXT NOT NULL,
  rangeKm INTEGER,
  cruiseKts INTEGER,
  co2GramsPerPaxKm INTEGER,
  seatMapId TEXT NOT NULL,
  seatMapName TEXT NOT NULL,
  seatsJson TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fare_classes (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cabin TEXT NOT NULL,
  baggageKg INTEGER NOT NULL,
  carryOnKg INTEGER NOT NULL,
  changesAllowed INTEGER NOT NULL,
  refundable INTEGER NOT NULL,
  sortOrder INTEGER NOT NULL,
  active INTEGER NOT NULL,
  multiplier REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS tax_rules (
  code TEXT NOT NULL,
  routeType TEXT NOT NULL,
  currency TEXT NOT NULL,
  name TEXT NOT NULL,
  calcType TEXT NOT NULL,
  percentBps INTEGER,
  flatMinor INTEGER,
  appliesTo TEXT NOT NULL,
  sortOrder INTEGER NOT NULL,
  active INTEGER NOT NULL,
  effectiveFrom TEXT NOT NULL,
  effectiveTo TEXT,
  PRIMARY KEY (code, routeType, currency)
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  flightNumber TEXT NOT NULL,
  originCode TEXT NOT NULL,
  destinationCode TEXT NOT NULL,
  aircraftTypeCode TEXT NOT NULL,
  departLocalMinutes INTEGER NOT NULL,
  durationMinutes INTEGER NOT NULL,
  daysOfWeekJson TEXT NOT NULL,
  routeType TEXT NOT NULL,
  effectiveFrom TEXT,
  effectiveTo TEXT,
  baseFareMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  saleStatus TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_od ON schedules (originCode, destinationCode);

-- ── generated flight instances ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flights (
  id TEXT PRIMARY KEY,
  scheduleId TEXT NOT NULL,
  flightNumber TEXT NOT NULL,
  originCode TEXT NOT NULL,
  destinationCode TEXT NOT NULL,
  routeType TEXT NOT NULL,
  aircraftTypeCode TEXT NOT NULL,
  flightDate TEXT NOT NULL,
  depUtc TEXT NOT NULL,
  arrUtc TEXT NOT NULL,
  boardingUtc TEXT,
  status TEXT NOT NULL,
  gate TEXT,
  delayMinutes INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  saleStatus TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flights_od_date ON flights (originCode, destinationCode, flightDate);
CREATE INDEX IF NOT EXISTS idx_flights_date ON flights (flightDate);
CREATE UNIQUE INDEX IF NOT EXISTS idx_flights_schedule_date ON flights (scheduleId, flightDate);

CREATE TABLE IF NOT EXISTS fares (
  flightId TEXT NOT NULL,
  fareClassCode TEXT NOT NULL,
  baseFareMinor INTEGER NOT NULL,
  saleStatus TEXT NOT NULL,
  PRIMARY KEY (flightId, fareClassCode)
);

CREATE TABLE IF NOT EXISTS inventory (
  flightId TEXT NOT NULL,
  fareClassCode TEXT NOT NULL,
  seatsTotal INTEGER NOT NULL,
  seatsHeld INTEGER NOT NULL DEFAULT 0,
  seatsSold INTEGER NOT NULL DEFAULT 0,
  seatsBlocked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (flightId, fareClassCode)
);

-- ── bookings ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  pnr TEXT NOT NULL UNIQUE,
  userId TEXT,
  status TEXT NOT NULL,
  tripType TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT NOT NULL,
  totalMinor INTEGER NOT NULL,
  breakdownJson TEXT NOT NULL,
  contactEmail TEXT,
  contactPhone TEXT,
  adultCount INTEGER NOT NULL,
  childCount INTEGER NOT NULL,
  infantCount INTEGER NOT NULL,
  locale TEXT NOT NULL,
  holdExpiresAt TEXT,
  expiresAt TEXT,
  createdAt TEXT NOT NULL,
  confirmedAt TEXT,
  cancelledAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings (userId);
CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings (createdAt);

CREATE TABLE IF NOT EXISTS booking_segments (
  bookingId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  flightId TEXT NOT NULL,
  fareClassCode TEXT NOT NULL,
  originCode TEXT NOT NULL,
  destinationCode TEXT NOT NULL,
  depUtc TEXT NOT NULL,
  arrUtc TEXT NOT NULL,
  fareMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  PRIMARY KEY (bookingId, seq)
);

CREATE TABLE IF NOT EXISTS booking_passengers (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  firstName TEXT NOT NULL,
  lastName TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  docType TEXT
);
CREATE INDEX IF NOT EXISTS idx_pax_booking ON booking_passengers (bookingId);

CREATE TABLE IF NOT EXISTS seat_holds (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  userId TEXT,
  flightId TEXT NOT NULL,
  seatLabel TEXT NOT NULL,
  status TEXT NOT NULL,
  token TEXT NOT NULL,
  activeKey TEXT UNIQUE,
  expiresAt TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  convertedAt TEXT,
  releasedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_holds_flight ON seat_holds (flightId, status);
CREATE INDEX IF NOT EXISTS idx_holds_booking ON seat_holds (bookingId);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  passengerId TEXT NOT NULL UNIQUE,
  flightId TEXT NOT NULL,
  seatLabel TEXT,
  ticketNumber TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  baggageKg INTEGER NOT NULL,
  fareMinor INTEGER NOT NULL,
  taxesMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  issuedAt TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_booking ON tickets (bookingId);
CREATE INDEX IF NOT EXISTS idx_tickets_flight ON tickets (flightId, status);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  passengerId TEXT NOT NULL UNIQUE,
  flightId TEXT NOT NULL,
  seatLabel TEXT,
  status TEXT NOT NULL,
  boardingSequence INTEGER,
  gate TEXT,
  checkedInAt TEXT,
  boardingPassId TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkins_flight ON checkins (flightId, status);

CREATE TABLE IF NOT EXISTS boarding_passes (
  id TEXT PRIMARY KEY,
  checkInId TEXT NOT NULL UNIQUE,
  bcbp TEXT NOT NULL,
  format TEXT NOT NULL,
  issuedAt TEXT NOT NULL
);

-- ── site appearance (public read; ADMIN-patched offline) ────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  app_name TEXT NOT NULL,
  theme TEXT NOT NULL,
  images_json TEXT NOT NULL,
  mpesa_paybill TEXT,
  updated_at TEXT NOT NULL
);

-- ── payments & M-Pesa verification ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  bookingId TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  idempotencyKey TEXT NOT NULL UNIQUE,
  providerRef TEXT,
  failureCode TEXT,
  failureMessage TEXT,
  manual INTEGER NOT NULL DEFAULT 0,
  paidAt TEXT,
  expiresAt TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments (bookingId);

CREATE TABLE IF NOT EXISTS mpesa_records (
  id TEXT PRIMARY KEY,
  receiptNumber TEXT NOT NULL UNIQUE,
  amountMinor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  msisdn TEXT,
  paybill TEXT,
  accountReference TEXT,
  transactionAt TEXT,
  messageRaw TEXT NOT NULL,
  status TEXT NOT NULL,
  paymentId TEXT,
  bookingId TEXT,
  submittedById TEXT,
  resolvedById TEXT,
  resolvedAt TEXT,
  rejectReason TEXT,
  notes TEXT,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mpesa_status ON mpesa_records (status, createdAt);
`;

export function ensureSchema(db: SqlDb): void {
  db.exec(DDL);
}

export { kvGet, kvSet };
