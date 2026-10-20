/**
 * Offline Ticket Vault (Phase 3 — offline-first).
 *
 * Boarding passes and booking summaries are persisted in expo-sqlite so the
 * Trips screen and the QR boarding pass render instantly with zero network.
 * On launch the vault is read synchronously (fast), then refreshed in the
 * background from the API. This means: airplane mode → open app → boarding
 * pass still renders with a working, high-contrast QR code.
 */
import * as SQLite from 'expo-sqlite';
import type { BoardingPassDto, BookingDto } from '@kenyaairways/shared';

const DB_NAME = 'ticket_vault.db';

export interface VaultBooking {
  id: string;
  pnr: string;
  status: string;
  currency: string;
  totalMinor: number;
  departUtc: string;
  arriveUtc: string;
  originCode: string;
  destinationCode: string;
  flightNumber: string;
  /** Full BookingDto JSON for detail screens. */
  payload: string;
  updatedAt: string;
}

export interface VaultPass {
  id: string;
  bookingId: string;
  passengerName: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  seatLabel: string | null;
  gate: string | null;
  /** BCBP string encoded in the QR. */
  bcbp: string;
  departureUtc: string;
  payload: string;
  updatedAt: string;
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const handle = await SQLite.openDatabaseAsync(DB_NAME);
      await handle.execAsync(`
        CREATE TABLE IF NOT EXISTS vault_bookings (
          id TEXT PRIMARY KEY NOT NULL,
          pnr TEXT NOT NULL,
          status TEXT NOT NULL,
          currency TEXT NOT NULL,
          totalMinor INTEGER NOT NULL,
          departUtc TEXT NOT NULL,
          arriveUtc TEXT NOT NULL,
          originCode TEXT NOT NULL,
          destinationCode TEXT NOT NULL,
          flightNumber TEXT NOT NULL,
          payload TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_passes (
          id TEXT PRIMARY KEY NOT NULL,
          bookingId TEXT NOT NULL,
          passengerName TEXT NOT NULL,
          flightNumber TEXT NOT NULL,
          originCode TEXT NOT NULL,
          destinationCode TEXT NOT NULL,
          seatLabel TEXT,
          gate TEXT,
          bcbp TEXT NOT NULL,
          departureUtc TEXT NOT NULL,
          payload TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_vault_bookings_updated ON vault_bookings(updatedAt);
        CREATE INDEX IF NOT EXISTS idx_vault_passes_booking ON vault_passes(bookingId);
      `);
      return handle;
    })();
  }
  return dbPromise;
}

/** Persist a booking (upsert) so the Trips screen works offline. */
export async function saveBooking(booking: BookingDto): Promise<void> {
  const handle = await db();
  const firstSegment = booking.segments[0];
  await handle.runAsync(
    `INSERT INTO vault_bookings
       (id, pnr, status, currency, totalMinor, departUtc, arriveUtc,
        originCode, destinationCode, flightNumber, payload, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status=excluded.status, totalMinor=excluded.totalMinor,
       payload=excluded.payload, updatedAt=excluded.updatedAt`,
    booking.id,
    booking.pnr,
    booking.status,
    booking.currency,
    booking.totalMinor,
    firstSegment?.departUtc ?? '',
    firstSegment?.arriveUtc ?? '',
    firstSegment?.originCode ?? '',
    firstSegment?.destinationCode ?? '',
    firstSegment?.flightNumber ?? '',
    JSON.stringify(booking),
    new Date().toISOString(),
  );
}

/** Persist a boarding pass so the QR renders without wifi. */
export async function savePass(pass: BoardingPassDto): Promise<void> {
  const handle = await db();
  await handle.runAsync(
    `INSERT INTO vault_passes
       (id, bookingId, passengerName, flightNumber, originCode, destinationCode,
        seatLabel, gate, bcbp, departureUtc, payload, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       seatLabel=excluded.seatLabel, gate=excluded.gate,
       payload=excluded.payload, updatedAt=excluded.updatedAt`,
    pass.id,
    pass.checkInId,
    pass.passengerName,
    pass.flightNumber,
    pass.originCode,
    pass.destinationCode,
    pass.seatLabel,
    pass.gate,
    pass.bcbp,
    pass.departureUtc,
    JSON.stringify(pass),
    new Date().toISOString(),
  );
}

/** All cached bookings, newest first — the offline Trips list. */
export async function listBookings(): Promise<VaultBooking[]> {
  const handle = await db();
  return handle.getAllAsync<VaultBooking>(
    `SELECT * FROM vault_bookings ORDER BY departUtc DESC LIMIT 50`,
  );
}

/** All boarding passes for one booking. */
export async function listPasses(bookingId: string): Promise<VaultPass[]> {
  const handle = await db();
  return handle.getAllAsync<VaultPass>(
    `SELECT * FROM vault_passes WHERE bookingId = ? ORDER BY passengerName`,
    bookingId,
  );
}

/** One boarding pass by id (for the QR detail screen). */
export async function getPass(id: string): Promise<VaultPass | null> {
  const handle = await db();
  return handle.getFirstAsync<VaultPass>(`SELECT * FROM vault_passes WHERE id = ?`, id);
}

/** Wipe the vault (sign-out). */
export async function clearVault(): Promise<void> {
  const handle = await db();
  await handle.execAsync(`DELETE FROM vault_bookings; DELETE FROM vault_passes;`);
}
