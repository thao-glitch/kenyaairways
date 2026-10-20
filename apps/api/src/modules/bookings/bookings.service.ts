import { Injectable } from '@nestjs/common';
import {
  AppError,
  canTransition,
  generateUniquePnr,
  isValidPnr,
  PASSENGER_FARE_BPS,
  toLocalIso,
  type BookingBreakdownLineDto,
  type BookingDto,
  type BookingSegmentDto,
  type PricingDto,
  type TicketDto,
} from '@kenyaairways/shared';
import type {
  Airport,
  Booking,
  BookingPassenger,
  BookingSegment,
  BookingStatus,
  Fare,
  FareClass,
  Flight,
  Role,
  SeatHold,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { PricingService } from '../pricing/pricing.service';
import { InventoryService } from './inventory.service';
import { RtEventsService } from '../../realtime/rt-events.service';
import { getEnv } from '../../config/env';
import { blindIndex, encryptField, randomToken } from '../../common/crypto';
import { maskDeep } from '../../common/logger';
import type { AuthUser } from '../../common/auth-request';
import type { CreateBookingDto, PassengerInputDto } from './dto/create-booking.dto';
import { toTicketDto } from '../ticketing/ticket-mapper';

export interface BookingActor {
  userId: string | null;
  role: Role;
  locale: string;
  /** Account phone (E.164) — OTP step-ups and payment msisdn fallback. */
  phone?: string | null;
  ip?: string;
  requestId?: string;
}

export function actorFromUser(user: AuthUser, ip?: string, requestId?: string): BookingActor {
  return {
    userId: user.id,
    role: user.role,
    locale: user.locale,
    phone: user.phone,
    ip,
    requestId,
  };
}

export const STAFF_ROLES: Role[] = ['AGENT', 'OPS', 'FINANCE', 'ADMIN'];
const SYSTEM_ACTOR: BookingActor = { userId: null, role: 'OPS', locale: 'en-KE' };

export interface ResolvedSegment {
  flight: Flight & { origin: Airport; destination: Airport };
  fare: Fare & { fareClass: FareClass };
  pricing: PricingDto;
}

type SegmentsWithRefs = (BookingSegment & {
  flight: { flightNumber: string; origin: { timezone: string }; destination: { timezone: string } };
  fareClass: { code: string };
})[];

type BookingWithRefs = Booking & {
  segments: SegmentsWithRefs;
  passengers: BookingPassenger[];
  seatHolds: (SeatHold & { seat: { label: string } })[];
};

type Db = PrismaService | Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

/**
 * Booking lifecycle (M4): create a HELD booking with an atomic inventory
 * reservation, seat holds backed by a DB-level unique `activeKey`, cancellation
 * and TTL expiry. Payments move HELD → PENDING_PAYMENT → CONFIRMED (M5).
 */
@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly rt: RtEventsService,
  ) {}

  async create(actor: BookingActor, dto: CreateBookingDto): Promise<BookingDto> {
    const env = getEnv();
    const counts = countPax(dto.passengers);
    if (counts.adults < 1) {
      throw new AppError('BAD_REQUEST', 'At least one adult passenger is required');
    }
    const seatPax = counts.adults + counts.children; // infants travel on laps

    const resolved: ResolvedSegment[] = [];
    const seenFlights = new Set<string>();
    for (const seg of dto.segments) {
      if (seenFlights.has(seg.flightId)) {
        throw new AppError('BAD_REQUEST', 'A flight may appear only once per booking');
      }
      seenFlights.add(seg.flightId);
      resolved.push(await this.resolveSegment(seg.flightId, seg.fareClassCode));
    }

    // Price snapshot: per-passenger-type fares + taxes (infants exempt from taxes).
    const lines: BookingBreakdownLineDto[] = [];
    let total = 0;
    for (const [index, seg] of resolved.entries()) {
      const infantBase = Math.round(
        (seg.pricing.baseFareMinor * PASSENGER_FARE_BPS.INFANT) / 10_000,
      );
      const fareAmount = seatPax * seg.pricing.baseFareMinor + counts.infants * infantBase;
      lines.push({
        code: `SEG${index + 1}_FARE`,
        label: `${seg.flight.flightNumber} base fare × ${seatPax} passenger(s)${
          counts.infants ? ` + ${counts.infants} infant(s)` : ''
        }`,
        amountMinor: fareAmount,
      });
      total += fareAmount;
      for (const tax of seg.pricing.taxes) {
        const amount = seatPax * tax.amountMinor;
        if (amount === 0) continue;
        lines.push({
          code: `SEG${index + 1}_${tax.code}`,
          label: `${seg.flight.flightNumber} · ${tax.name}`,
          amountMinor: amount,
        });
        total += amount;
      }
    }

    const pnr = await generateUniquePnr(async (candidate) => {
      const existing = await this.prisma.booking.findUnique({ where: { pnr: candidate } });
      return existing !== null;
    });

    const expiresAt = new Date(Date.now() + env.BOOKING_EXPIRE_TTL_SECONDS * 1000);
    const owner = actor.userId
      ? await this.prisma.user.findUnique({
          where: { id: actor.userId },
          select: { email: true, phone: true },
        })
      : null;

    const booking = await this.prisma.$transaction(async (tx) => {
      for (const seg of resolved) {
        const held = await this.inventory.hold(tx, seg.flight.id, seg.fare.fareClassId, seatPax);
        if (!held) {
          throw new AppError(
            'SEAT_UNAVAILABLE',
            `Not enough seats on ${seg.flight.flightNumber} (${seg.fare.fareClass.code})`,
          );
        }
      }

      const created = await tx.booking.create({
        data: {
          pnr,
          userId: actor.userId,
          status: 'HELD',
          tripType: dto.tripType,
          source: dto.source ?? 'WEB',
          currency: 'KES',
          totalMinor: total,
          breakdown: lines as unknown as object,
          contactEmail: dto.contactEmail ?? owner?.email ?? null,
          contactPhone: dto.contactPhone ?? owner?.phone ?? null,
          adultCount: counts.adults,
          childCount: counts.children,
          infantCount: counts.infants,
          locale: dto.locale ?? actor.locale,
          holdExpiresAt: expiresAt,
          expiresAt,
          segments: {
            create: resolved.map((seg, index) => ({
              seq: index + 1,
              flightId: seg.flight.id,
              fareClassId: seg.fare.fareClassId,
              originCode: seg.flight.originCode,
              destinationCode: seg.flight.destinationCode,
              depUtc: seg.flight.scheduledDepUtc,
              arrUtc: seg.flight.scheduledArrUtc,
              fareMinor: seg.pricing.totalMinor,
              currency: seg.pricing.currency,
            })),
          },
          passengers: {
            create: dto.passengers.map((pax, index) => this.toPassengerRow(pax, index + 1)),
          },
        },
        include: this.include(),
      });

      for (const seatReq of dto.seats ?? []) {
        const seg = resolved[seatReq.segmentSeq];
        if (!seg) throw new AppError('BAD_REQUEST', 'seats.segmentSeq does not match a segment');
        await this.insertSeatHold(
          tx,
          created.id,
          actor.userId,
          seg.flight.id,
          seatReq.seatLabel,
          expiresAt,
        );
      }
      // Re-read: `created` was snapshotted before the seat holds existed.
      return tx.booking.findUniqueOrThrow({ where: { id: created.id }, include: this.include() });
    });

    await this.audit('booking.create', actor, booking.id, 'SUCCESS', { pnr, totalMinor: total });
    // Real-time: the new hold (and any seats grabbed during creation) so a
    // client already watching the flight/booking rooms sees them instantly.
    await this.rt.bookingUpdated(booking.id);
    for (const hold of booking.seatHolds) {
      if (hold.status !== 'ACTIVE') continue;
      await this.rt.seatChanged('seat.held', {
        flightId: hold.flightId,
        seatId: hold.seatId,
        label: hold.seat.label,
        expiresAt: hold.expiresAt,
      });
    }
    return toBookingDto(booking);
  }

  async get(id: string, actor: BookingActor): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertAccess(booking, actor);
    return toBookingDto(booking);
  }

  /** `GET /pnr/:code` — a PNR is a locator, never a credential: auth + access. */
  async getByPnr(
    actor: BookingActor,
    code: string,
  ): Promise<{ booking: BookingDto; tickets: TicketDto[] }> {
    const pnr = code.trim().toUpperCase();
    const booking = isValidPnr(pnr)
      ? await this.prisma.booking.findUnique({ where: { pnr }, include: this.include() })
      : null;
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertAccess(booking, actor);
    const tickets = await this.prisma.ticket.findMany({
      where: { bookingId: booking.id },
      include: { bookingPassenger: true },
      orderBy: { createdAt: 'asc' },
    });
    return { booking: toBookingDto(booking), tickets: tickets.map(toTicketDto) };
  }

  async listMine(
    actor: BookingActor,
    page = 1,
    pageSize = 20,
  ): Promise<{
    items: BookingDto[];
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  }> {
    if (!actor.userId) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    const size = Math.min(50, Math.max(1, pageSize));
    const current = Math.max(1, page);
    const where = { userId: actor.userId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.booking.count({ where }),
      this.prisma.booking.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (current - 1) * size,
        take: size,
        include: this.include(),
      }),
    ]);
    return {
      items: rows.map(toBookingDto),
      page: current,
      pageSize: size,
      total,
      hasMore: current * size < total,
    };
  }

  /** Cancels a booking and returns its inventory (held or sold, as applicable). */
  async cancel(id: string, actor: BookingActor, reason?: string): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertAccess(booking, actor);

    // Seats this booking currently blocks — must be re-broadcast as free.
    const heldSeats = booking.seatHolds.filter(
      (h) => h.status === 'ACTIVE' || h.status === 'CONVERTED',
    );

    const changed = await this.transition(booking.id, 'CANCELLED', async (tx, current) => {
      const seats = current.adultCount + current.childCount;
      if (current.status === 'CONFIRMED' || current.status === 'CHECKED_IN') {
        for (const seg of current.segments) {
          await this.inventory.releaseSold(tx, seg.flightId, seg.fareClassId, seats);
        }
      } else {
        for (const seg of current.segments) {
          await this.inventory.releaseHold(tx, seg.flightId, seg.fareClassId, seats);
        }
      }
      // ACTIVE holds block a seat via activeKey; CONVERTED holds were sold —
      // both must be released when the booking dies.
      await tx.seatHold.updateMany({
        where: { bookingId: current.id, status: { in: ['ACTIVE', 'CONVERTED'] } },
        data: { status: 'RELEASED', releasedAt: new Date(), activeKey: null },
      });
    });
    if (!changed) {
      throw new AppError('INVALID_STATE_TRANSITION', `Booking ${booking.pnr} cannot be cancelled`);
    }

    await this.audit('booking.cancel', actor, id, 'SUCCESS', { pnr: booking.pnr, reason });
    await this.rt.bookingUpdated(id);
    for (const hold of heldSeats) {
      await this.rt.seatChanged('seat.released', {
        flightId: hold.flightId,
        seatId: hold.seatId,
        label: hold.seat.label,
      });
    }
    const fresh = await this.prisma.booking.findUnique({ where: { id }, include: this.include() });
    return toBookingDto(fresh!);
  }

  /**
   * Payment captured: the booking is confirmed and held seats become sold.
   * Callable inside an external transaction (`db`) so the payment claim and
   * the booking/inventory flip commit atomically — the optimistic transition
   * guard makes concurrent confirmations no-ops.
   */
  async confirmPaid(id: string, db?: Db): Promise<boolean> {
    return this.transition(
      id,
      'CONFIRMED',
      async (tx, current) => {
        const seats = current.adultCount + current.childCount;
        for (const seg of current.segments) {
          await this.inventory.convertHoldToSold(tx, seg.flightId, seg.fareClassId, seats);
        }
        await tx.seatHold.updateMany({
          where: { bookingId: current.id, status: 'ACTIVE' },
          data: { status: 'CONVERTED', convertedAt: new Date(), activeKey: null },
        });
      },
      db,
    );
  }

  /**
   * Full refund completed: sold seats return to the pool (only if this
   * booking still holds them — a prior cancellation already released them).
   */
  async markRefunded(id: string, db?: Db): Promise<boolean> {
    return this.transition(
      id,
      'REFUNDED',
      async (tx, current) => {
        if (current.status === 'CONFIRMED' || current.status === 'CHECKED_IN') {
          const seats = current.adultCount + current.childCount;
          for (const seg of current.segments) {
            await this.inventory.releaseSold(tx, seg.flightId, seg.fareClassId, seats);
          }
        }
        await tx.seatHold.updateMany({
          where: { bookingId: current.id, status: { in: ['ACTIVE', 'CONVERTED'] } },
          data: { status: 'RELEASED', releasedAt: new Date(), activeKey: null },
        });
      },
      db,
    );
  }

  /** Holds a specific seat for this booking (seat-map selection). */
  async holdSeat(
    id: string,
    actor: BookingActor,
    seatLabel: string,
    segmentSeq = 0,
  ): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertAccess(booking, actor);
    if (
      booking.status !== 'HELD' &&
      booking.status !== 'PENDING_PAYMENT' &&
      booking.status !== 'CONFIRMED'
    ) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Cannot select seats while booking is ${booking.status}`,
      );
    }
    const segment = booking.segments.find((s) => s.seq === segmentSeq + 1);
    if (!segment) throw new AppError('BAD_REQUEST', 'Unknown segment');

    await this.insertSeatHold(
      this.prisma,
      booking.id,
      actor.userId,
      segment.flightId,
      seatLabel,
      booking.expiresAt ?? new Date(Date.now() + getEnv().BOOKING_EXPIRE_TTL_SECONDS * 1000),
    );
    const fresh = await this.prisma.booking.findUnique({ where: { id }, include: this.include() });
    const hold = fresh?.seatHolds.find((h) => h.seat.label === seatLabel && h.status === 'ACTIVE');
    if (hold) {
      await this.rt.seatChanged('seat.held', {
        flightId: hold.flightId,
        seatId: hold.seatId,
        label: hold.seat.label,
        expiresAt: hold.expiresAt,
      });
    }
    return toBookingDto(fresh!);
  }

  async releaseSeat(id: string, actor: BookingActor, seatLabel: string): Promise<BookingDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    assertAccess(booking, actor);
    const target = booking.seatHolds.find(
      (h) => h.seat.label === seatLabel && h.status === 'ACTIVE',
    );
    if (!target) throw new AppError('NOT_FOUND', 'Seat hold not found on this booking');
    await this.prisma.seatHold.update({
      where: { id: target.id },
      data: { status: 'RELEASED', releasedAt: new Date(), activeKey: null },
    });
    await this.rt.seatChanged('seat.released', {
      flightId: target.flightId,
      seatId: target.seatId,
      label: seatLabel,
    });
    const fresh = await this.prisma.booking.findUnique({ where: { id }, include: this.include() });
    return toBookingDto(fresh!);
  }

  /** Called by the BullMQ sweeper: expires overdue bookings and frees seats. */
  async expireDue(): Promise<number> {
    const due = await this.prisma.booking.findMany({
      where: { status: { in: ['HELD', 'PENDING_PAYMENT'] }, expiresAt: { lt: new Date() } },
      select: { id: true },
      take: 200,
    });
    let expired = 0;
    for (const row of due) {
      const heldSeats = await this.prisma.seatHold.findMany({
        where: { bookingId: row.id, status: 'ACTIVE' },
        select: { flightId: true, seatId: true, seat: { select: { label: true } } },
      });
      const changed = await this.transition(row.id, 'EXPIRED', async (tx, current) => {
        const seats = current.adultCount + current.childCount;
        for (const seg of current.segments) {
          await this.inventory.releaseHold(tx, seg.flightId, seg.fareClassId, seats);
        }
        await tx.seatHold.updateMany({
          where: { bookingId: current.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', releasedAt: new Date(), activeKey: null },
        });
      });
      if (changed) {
        expired += 1;
        await this.rt.bookingUpdated(row.id);
        for (const hold of heldSeats) {
          await this.rt.seatChanged('seat.released', {
            flightId: hold.flightId,
            seatId: hold.seatId,
            label: hold.seat.label,
          });
        }
      }
    }
    if (expired > 0) {
      await this.audit('booking.expire', SYSTEM_ACTOR, undefined, 'SUCCESS', { count: expired });
    }
    return expired;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private include() {
    return {
      segments: {
        orderBy: { seq: 'asc' as const },
        include: {
          flight: {
            select: {
              flightNumber: true,
              origin: { select: { timezone: true } },
              destination: { select: { timezone: true } },
            },
          },
          fareClass: { select: { code: true } },
        },
      },
      passengers: { orderBy: { seq: 'asc' as const } },
      seatHolds: {
        include: { seat: { select: { label: true } } },
        orderBy: { createdAt: 'asc' as const },
      },
    } as const;
  }

  private async resolveSegment(flightId: string, fareClassCode: string): Promise<ResolvedSegment> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: { origin: true, destination: true },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');
    if (flight.status === 'CANCELLED') {
      throw new AppError('CONFLICT', `Flight ${flight.flightNumber} is cancelled`);
    }
    const fare = await this.prisma.fare.findFirst({
      where: { flightId, saleStatus: 'OPEN', fareClass: { code: fareClassCode, active: true } },
      include: { fareClass: true },
    });
    if (!fare) {
      throw new AppError('NOT_FOUND', `Fare class ${fareClassCode} is not offered on this flight`);
    }
    const pricing = await this.pricing.price({
      routeType: flight.routeType,
      baseFareMinor: fare.baseFareMinor,
      currency: fare.currency,
    });
    return { flight, fare, pricing };
  }

  private toPassengerRow(pax: PassengerInputDto, seq: number) {
    const env = getEnv();
    return {
      seq,
      type: pax.type,
      firstName: pax.firstName.trim(),
      lastName: pax.lastName.trim(),
      middleName: pax.middleName?.trim() || null,
      dateOfBirth: pax.dateOfBirth ? new Date(pax.dateOfBirth) : null,
      nationality: pax.nationality?.toUpperCase() ?? null,
      docType: pax.docType ?? null,
      docNumberEncrypted: pax.docNumber ? encryptField(pax.docNumber, env.ENCRYPTION_KEY) : null,
      docNumberHash: pax.docNumber ? blindIndex(pax.docNumber, env.ENCRYPTION_KEY) : null,
      docExpiry: pax.docExpiry ? new Date(pax.docExpiry) : null,
      email: pax.email?.toLowerCase() ?? null,
      phone: pax.phone ?? null,
      mealPreference: pax.mealPreference ?? null,
    };
  }

  private async insertSeatHold(
    db: Db,
    bookingId: string,
    userId: string | null,
    flightId: string,
    seatLabel: string,
    expiresAt: Date,
  ): Promise<void> {
    const flight = await db.flight.findUnique({
      where: { id: flightId },
      include: { aircraft: { include: { aircraftType: { include: { seatMap: true } } } } },
    });
    const seatMapId = flight?.aircraft?.aircraftType.seatMap?.id;
    if (!seatMapId) throw new AppError('BAD_REQUEST', 'No seat map is assigned to this flight');
    const seat = await db.seat.findUnique({
      where: { seatMapId_label: { seatMapId, label: seatLabel } },
    });
    if (!seat || !seat.active) throw new AppError('NOT_FOUND', `Seat ${seatLabel} does not exist`);
    if (seat.blocked) throw new AppError('SEAT_UNAVAILABLE', `Seat ${seatLabel} is blocked`);

    // Free lapsed holds first so a seat never stays blocked by a dead row.
    await db.seatHold.updateMany({
      where: { seatId: seat.id, status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', activeKey: null, releasedAt: new Date() },
    });

    try {
      await db.seatHold.create({
        data: {
          flightId,
          seatId: seat.id,
          bookingId,
          userId,
          token: randomToken(16),
          activeKey: `${flightId}:${seat.id}`, // unique index → no double-hold, ever
          status: 'ACTIVE',
          expiresAt,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new AppError('SEAT_UNAVAILABLE', `Seat ${seatLabel} is already held`);
      }
      throw err;
    }
  }

  /** Optimistic status transition: only one caller can win the race. */
  private async transition(
    id: string,
    to: BookingStatus,
    release: (tx: Db, current: Booking & { segments: BookingSegment[] }) => Promise<void>,
    external?: Db,
  ): Promise<boolean> {
    const run = async (tx: Db): Promise<boolean> => {
      const current = await tx.booking.findUnique({ where: { id }, include: { segments: true } });
      if (!current || !canTransition(current.status, to)) return false;

      const res = await tx.booking.updateMany({
        where: { id, status: current.status },
        data: {
          status: to,
          cancelledAt: to === 'CANCELLED' ? new Date() : undefined,
          confirmedAt: to === 'CONFIRMED' ? new Date() : undefined,
        },
      });
      if (res.count !== 1) return false; // lost the race — caller re-reads

      await release(tx, current);
      return true;
    };
    return external ? run(external) : this.prisma.$transaction(run);
  }

  private async audit(
    action: string,
    actor: BookingActor,
    entityId: string | undefined,
    outcome: 'SUCCESS' | 'FAILURE' | 'DENIED',
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'booking',
          entityId,
          outcome,
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: metadata ? (maskDeep(metadata) as object) : undefined,
        },
      });
    } catch {
      // audit failures must never fail the business action
    }
  }
}

function assertAccess(booking: { userId: string | null }, actor: BookingActor): void {
  if (STAFF_ROLES.includes(actor.role)) return;
  if (actor.userId && booking.userId === actor.userId) return;
  throw new AppError('FORBIDDEN', 'You do not have access to this booking');
}

function countPax(passengers: PassengerInputDto[]): {
  adults: number;
  children: number;
  infants: number;
} {
  const counts = { adults: 0, children: 0, infants: 0 };
  for (const p of passengers) {
    if (p.type === 'ADULT') counts.adults += 1;
    else if (p.type === 'CHILD') counts.children += 1;
    else counts.infants += 1;
  }
  return counts;
}

export function toBookingDto(booking: BookingWithRefs): BookingDto {
  const breakdown = (booking.breakdown ?? []) as unknown as BookingBreakdownLineDto[];
  return {
    id: booking.id,
    pnr: booking.pnr,
    status: booking.status,
    tripType: booking.tripType,
    source: booking.source,
    currency: booking.currency as BookingDto['currency'],
    totalMinor: booking.totalMinor,
    breakdown,
    contactEmail: booking.contactEmail,
    contactPhone: booking.contactPhone,
    adultCount: booking.adultCount,
    childCount: booking.childCount,
    infantCount: booking.infantCount,
    locale: booking.locale,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    expiresAt: booking.expiresAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
    segments: booking.segments.map((seg) => ({
      seq: seg.seq,
      flightId: seg.flightId,
      flightNumber: seg.flight.flightNumber,
      originCode: seg.originCode,
      destinationCode: seg.destinationCode,
      departUtc: seg.depUtc.toISOString(),
      arriveUtc: seg.arrUtc.toISOString(),
      departLocal: toLocalIso(seg.depUtc, seg.flight.origin.timezone),
      arriveLocal: toLocalIso(seg.arrUtc, seg.flight.destination.timezone),
      fareClassCode: seg.fareClass.code,
      fareMinor: seg.fareMinor,
      currency: seg.currency as BookingSegmentDto['currency'],
    })),
    passengers: booking.passengers.map((p) => ({
      seq: p.seq,
      type: p.type,
      firstName: p.firstName,
      lastName: p.lastName,
      email: p.email,
      phone: p.phone,
      docType: p.docType,
    })),
    seatHolds: booking.seatHolds.map((h) => ({
      flightId: h.flightId,
      seatLabel: h.seat.label,
      status: h.status,
      expiresAt: h.expiresAt.toISOString(),
    })),
  };
}
