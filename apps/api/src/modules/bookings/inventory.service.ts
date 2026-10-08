import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export type Db = Prisma.TransactionClient;

/**
 * Inventory mutations are single conditional UPDATE statements: Postgres locks
 * the row for the duration of the statement, and the availability predicate is
 * evaluated *in the same statement* — so two concurrent requests can never both
 * succeed for the last seat (no read-then-write race, no application locks).
 *
 * seatsAvailable = seatsTotal - seatsHeld - seatsSold - seatsBlocked
 */
@Injectable()
export class InventoryService {
  /** Reserves `seats` (moves nothing between held/sold). Returns false when short. */
  async hold(
    db: Prisma.TransactionClient,
    flightId: string,
    fareClassId: string,
    seats: number,
  ): Promise<boolean> {
    if (seats <= 0) return true;
    const affected = await db.$executeRaw`
      UPDATE "Inventory"
      SET "seatsHeld" = "seatsHeld" + ${seats}, "version" = "version" + 1, "updatedAt" = now()
      WHERE "flightId" = ${flightId}
        AND "fareClassId" = ${fareClassId}
        AND "seatsTotal" - "seatsHeld" - "seatsSold" - "seatsBlocked" >= ${seats}`;
    return affected === 1;
  }

  /** Gives held seats back (expiry, cancellation of an unpaid booking). */
  async releaseHold(
    db: Prisma.TransactionClient,
    flightId: string,
    fareClassId: string,
    seats: number,
  ): Promise<void> {
    if (seats <= 0) return;
    await db.$executeRaw`
      UPDATE "Inventory"
      SET "seatsHeld" = GREATEST("seatsHeld" - ${seats}, 0), "version" = "version" + 1, "updatedAt" = now()
      WHERE "flightId" = ${flightId} AND "fareClassId" = ${fareClassId} AND "seatsHeld" >= 0`;
  }

  /** Payment captured: held seats become sold seats. */
  async convertHoldToSold(
    db: Prisma.TransactionClient,
    flightId: string,
    fareClassId: string,
    seats: number,
  ): Promise<void> {
    if (seats <= 0) return;
    await db.$executeRaw`
      UPDATE "Inventory"
      SET "seatsHeld" = GREATEST("seatsHeld" - ${seats}, 0),
          "seatsSold" = "seatsSold" + ${seats},
          "version" = "version" + 1, "updatedAt" = now()
      WHERE "flightId" = ${flightId} AND "fareClassId" = ${fareClassId}`;
  }

  /** Refund/cancellation of a confirmed booking: sold seats come back. */
  async releaseSold(
    db: Prisma.TransactionClient,
    flightId: string,
    fareClassId: string,
    seats: number,
  ): Promise<void> {
    if (seats <= 0) return;
    await db.$executeRaw`
      UPDATE "Inventory"
      SET "seatsSold" = GREATEST("seatsSold" - ${seats}, 0), "version" = "version" + 1, "updatedAt" = now()
      WHERE "flightId" = ${flightId} AND "fareClassId" = ${fareClassId}`;
  }
}
