import { Injectable } from '@nestjs/common';
import {
  AppError,
  buildBcbp,
  checkInWindow,
  type BoardingPassDto,
  type CheckInDto,
  type CheckInResultDto,
} from '@flight13/shared';
import { getEnv } from '../../config/env';
import { randomToken } from '../../common/crypto';
import { createLogger, maskDeep } from '../../common/logger';
import { PrismaService } from '../../prisma/prisma.module';
import { RtEventsService } from '../../realtime/rt-events.service';
import { STAFF_ROLES, type BookingActor } from '../bookings/bookings.service';
import { mirrorSms } from '../notifications/mirror';
import { renderNotification } from '../notifications/templates';
import { SmsSender } from '../notifications/sms.sender';

interface CheckInLike {
  id: string;
  bookingId: string;
  bookingPassengerId: string;
  flightId: string;
  seatLabel: string | null;
  status: string;
  boardingSequence: number | null;
  gate: string | null;
  checkedInAt: Date | null;
  bookingPassenger?: { firstName: string; lastName: string } | null;
  boardingPass?: { id: string } | null;
}

function toCheckInDto(row: CheckInLike, fallbackName: string): CheckInDto {
  return {
    id: row.id,
    bookingId: row.bookingId,
    bookingPassengerId: row.bookingPassengerId,
    passengerName: row.bookingPassenger
      ? `${row.bookingPassenger.firstName} ${row.bookingPassenger.lastName}`
      : fallbackName,
    flightId: row.flightId,
    seatLabel: row.seatLabel,
    status: row.status as CheckInDto['status'],
    boardingSequence: row.boardingSequence,
    gate: row.gate,
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    boardingPassId: row.boardingPass?.id ?? null,
  };
}

/**
 * Check-in and boarding passes (M7).
 *
 * Rules enforced here:
 *  - only a CONFIRMED/CHECKED_IN booking, owner or staff;
 *  - the shared `checkInWindow` gates too-early/too-late attempts;
 *  - every passenger must hold an issued ticket first;
 *  - a seat must exist: the passenger's ticketed seat if this booking owns it,
 *    otherwise the first free seat — claimed through a CONVERTED `SeatHold`
 *    whose unique `activeKey` makes concurrent allocations race-safe;
 *  - re-running the same request is a no-op (unique `bookingPassengerId`),
 *    so double-submits never double-assign;
 *  - the boarding pass stores the IATA BCBP `M1` payload.
 *
 * Seat allocation happens at check-in as a safety net: everyone who paid for
 * a specific seat keeps it, seatless passengers (or walk-ups) get the best
 * remaining seat, and the booking flips to CHECKED_IN once all passengers are
 * checked in.
 */
@Injectable()
export class CheckInService {
  private readonly log = createLogger('checkin');

  constructor(
    private readonly prisma: PrismaService,
    private readonly rt: RtEventsService,
    private readonly sms: SmsSender,
  ) {}

  async checkIn(
    actor: BookingActor,
    bookingId: string,
    passengerIds?: string[],
  ): Promise<CheckInResultDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        segments: {
          orderBy: { seq: 'asc' },
          include: {
            flight: {
              include: {
                aircraft: {
                  include: {
                    aircraftType: { include: { seatMap: { include: { seats: true } } } },
                  },
                },
              },
            },
            fareClass: true,
          },
        },
        passengers: { orderBy: { seq: 'asc' } },
        tickets: { include: { bookingPassenger: true } },
        checkIns: {
          include: { boardingPass: { select: { id: true } }, bookingPassenger: true },
        },
      },
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    if (!(STAFF_ROLES.includes(actor.role) || booking.userId === actor.userId)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Passengers can only check in for a confirmed booking — this one is ${booking.status}`,
      );
    }
    const segment = booking.segments[0];
    if (!segment) throw new AppError('INVALID_STATE_TRANSITION', 'Booking has no segments');
    const flight = segment.flight;

    const env = getEnv();
    const window = checkInWindow(flight.scheduledDepUtc, new Date(), {
      openHours: env.CHECK_IN_OPEN_HOURS,
      closeMinutes: env.CHECK_IN_CLOSE_MINUTES,
    });
    if (!window.open) {
      throw new AppError(
        'CHECK_IN_CLOSED',
        window.reason === 'TOO_EARLY'
          ? `Check-in opens ${env.CHECK_IN_OPEN_HOURS} hours before departure`
          : `Check-in has closed — the cutoff is ${env.CHECK_IN_CLOSE_MINUTES} minutes before departure`,
      );
    }

    const requested = passengerIds?.length
      ? booking.passengers.filter((p) => passengerIds.includes(p.id))
      : booking.passengers;
    if (requested.length === 0) {
      throw new AppError('BAD_REQUEST', 'No matching passengers to check in');
    }
    if (passengerIds?.length && requested.length !== new Set(passengerIds).size) {
      throw new AppError('BAD_REQUEST', 'passengerIds must belong to this booking');
    }

    const ticketByPax = new Map(
      booking.tickets.filter((t) => t.status === 'ISSUED').map((t) => [t.bookingPassengerId, t]),
    );
    if (requested.some((p) => !ticketByPax.has(p.id))) {
      throw new AppError('INVALID_STATE_TRANSITION', 'Tickets must be issued before check-in');
    }

    const checkedByPax = new Map(booking.checkIns.map((c) => [c.bookingPassengerId, c]));
    const alreadyChecked = requested.filter((p) => checkedByPax.get(p.id)?.status === 'CHECKED_IN');
    const pending = requested.filter((p) => checkedByPax.get(p.id)?.status !== 'CHECKED_IN');

    // Who owns which seat on this flight right now.
    const [holds, ticketsOnFlight, checkInsOnFlight] = await Promise.all([
      this.prisma.seatHold.findMany({
        where: { flightId: flight.id, status: { in: ['ACTIVE', 'CONVERTED'] } },
        select: { seatId: true, bookingId: true },
      }),
      this.prisma.ticket.findMany({
        where: { flightId: flight.id, status: 'ISSUED' },
        select: { seatId: true, bookingId: true },
      }),
      this.prisma.checkIn.findMany({
        where: { flightId: flight.id, seatId: { not: null } },
        select: { seatId: true, bookingId: true },
      }),
    ]);
    const ours = new Set<string>();
    const theirs = new Set<string>();
    const add = (set: Set<string>, seatId: string | null) => {
      if (seatId) set.add(seatId);
    };
    for (const h of holds) add(h.bookingId === booking.id ? ours : theirs, h.seatId);
    for (const t of ticketsOnFlight) add(t.bookingId === booking.id ? ours : theirs, t.seatId);
    for (const c of checkInsOnFlight) add(c.bookingId === booking.id ? ours : theirs, c.seatId);

    const seatMapSeats = (flight.aircraft?.aircraftType.seatMap?.seats ?? [])
      .filter((s) => s.active && !s.blocked)
      .sort((a, b) => a.row - b.row || a.letter.localeCompare(b.letter));
    const free = seatMapSeats.filter((s) => !theirs.has(s.id));
    const carrier = env.AIRLINE_IATA_CODE || 'F1';
    const flightDigits =
      flight.flightNumber.replace(new RegExp(`^${carrier}`, 'i'), '').replace(/\D/g, '') ||
      flight.flightNumber.replace(/\D/g, '');

    const claimed = new Set<string>(); // seats handed out during this request
    let sequence =
      (await this.prisma.checkIn.count({
        where: { flightId: flight.id, status: 'CHECKED_IN' },
      })) + 1;
    const dtos: CheckInDto[] = [];

    for (const pax of pending) {
      const ticket = ticketByPax.get(pax.id)!;
      const desired = ticket.seatLabel
        ? seatMapSeats.find((s) => s.label === ticket.seatLabel)
        : undefined;
      const useDesired = desired !== undefined && ours.has(desired.id) && !claimed.has(desired.id);
      const seat = useDesired ? desired : free.find((s) => !claimed.has(s.id));
      if (!seat) {
        throw new AppError(
          'SEAT_UNAVAILABLE',
          `No seat left on ${flight.flightNumber} — please contact the airline`,
        );
      }
      claimed.add(seat.id);

      const passengerName = `${pax.firstName} ${pax.lastName}`;
      const row = await this.prisma.$transaction(async (tx) => {
        if (!ours.has(seat.id)) {
          // Fresh claim: the unique activeKey (<flight>:<seat>) makes a
          // concurrent allocation of the same free seat fail instead of
          // double-assigning.
          try {
            await tx.seatHold.create({
              data: {
                flightId: flight.id,
                seatId: seat.id,
                bookingId: booking.id,
                userId: actor.userId,
                token: randomToken(16),
                activeKey: `${flight.id}:${seat.id}`,
                status: 'CONVERTED',
                expiresAt: flight.scheduledDepUtc,
                convertedAt: new Date(),
              },
            });
          } catch (err) {
            const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
            if (code === 'P2002') {
              throw new AppError('SEAT_UNAVAILABLE', `Seat ${seat.label} was just taken`);
            }
            throw err;
          }
        }
        const checkIn = await tx.checkIn.upsert({
          where: { bookingPassengerId: pax.id },
          create: {
            bookingPassengerId: pax.id,
            bookingId: booking.id,
            flightId: flight.id,
            seatId: seat.id,
            seatLabel: seat.label,
            status: 'CHECKED_IN',
            boardingSequence: sequence,
            gate: flight.gate,
            checkedInAt: new Date(),
            source: 'WEB',
          },
          update: {
            seatId: seat.id,
            seatLabel: seat.label,
            status: 'CHECKED_IN',
            boardingSequence: sequence,
            gate: flight.gate,
            checkedInAt: new Date(),
          },
        });
        // Keep the coupon and the boarding record in agreement.
        await tx.ticket.update({
          where: { id: ticket.id },
          data: { seatId: seat.id, seatLabel: seat.label },
        });
        return checkIn;
      });
      sequence += 1;

      const bcbp = buildBcbp({
        lastName: pax.lastName,
        firstName: pax.firstName,
        pnr: booking.pnr,
        origin: flight.originCode,
        destination: flight.destinationCode,
        carrier,
        flightNumber: flightDigits,
        departureUtc: flight.scheduledDepUtc,
        bookingClass: segment.fareClass.code.charAt(0) || 'Y',
        seat: seat.label,
        sequence: row.boardingSequence ?? 1,
      });
      const pass = await this.prisma.boardingPass.upsert({
        where: { checkInId: row.id },
        create: { checkInId: row.id, bcbp, format: 'PDF' },
        update: { bcbp },
      });
      if (!ours.has(seat.id)) {
        await this.rt.seatChanged('seat.booked', {
          flightId: flight.id,
          seatId: seat.id,
          label: seat.label,
        });
      }
      dtos.push(
        toCheckInDto(
          { ...row, bookingPassenger: pax, boardingPass: { id: pass.id } },
          passengerName,
        ),
      );
    }

    // Everyone aboard → booking-level CHECKED_IN (guarded optimistic flip).
    let bookingStatus = booking.status;
    if (booking.status === 'CONFIRMED') {
      const checkedCount = await this.prisma.checkIn.count({
        where: { bookingId: booking.id, status: 'CHECKED_IN' },
      });
      if (checkedCount >= booking.passengers.length) {
        const flipped = await this.prisma.booking.updateMany({
          where: { id: booking.id, status: 'CONFIRMED' },
          data: { status: 'CHECKED_IN' },
        });
        if (flipped.count === 1) bookingStatus = 'CHECKED_IN';
      }
    }

    if (pending.length > 0) {
      try {
        await this.prisma.auditLog.create({
          data: {
            action: 'checkin.complete',
            actorId: actor.userId,
            actorRole: actor.role,
            entityType: 'booking',
            entityId: booking.id,
            outcome: 'SUCCESS',
            ip: actor.ip,
            requestId: actor.requestId,
            metadata: maskDeep({
              pnr: booking.pnr,
              count: pending.length,
              seats: dtos.map((d) => d.seatLabel),
            }) as object,
          },
        });
      } catch {
        // audit must never fail a completed check-in
      }
      const { subject, body } = renderNotification('checkin.completed', booking.locale, {
        pnr: booking.pnr,
        seats: dtos.map((d) => d.seatLabel ?? '-').join(', '),
      });
      const notification = await this.prisma.notification.create({
        data: {
          userId: booking.userId,
          bookingId: booking.id,
          channel: 'INAPP',
          templateCode: 'checkin.completed',
          recipient: booking.contactEmail ?? booking.contactPhone ?? '-',
          subject,
          body,
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      await this.rt.notificationNew(notification.id);
      await mirrorSms(this.prisma, this.sms, this.log, booking, 'checkin.completed', subject, body);
      if (bookingStatus !== booking.status) await this.rt.bookingUpdated(booking.id);
    }

    const merged = new Map<string, CheckInDto>();
    for (const row of alreadyChecked) {
      const stored = checkedByPax.get(row.id)!;
      merged.set(row.id, toCheckInDto(stored, `${row.firstName} ${row.lastName}`));
    }
    for (const dto of dtos) merged.set(dto.bookingPassengerId, dto);
    return {
      checkIns: [...merged.values()],
      bookingStatus: bookingStatus as CheckInResultDto['bookingStatus'],
    };
  }

  /** `GET /check-in?bookingId=` — current check-in rows (owner or staff). */
  async getByBooking(actor: BookingActor, bookingId: string): Promise<CheckInResultDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        userId: true,
        status: true,
        passengers: {
          orderBy: { seq: 'asc' },
          select: { id: true, firstName: true, lastName: true },
        },
        checkIns: {
          include: { boardingPass: { select: { id: true } }, bookingPassenger: true },
        },
      },
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    if (!(STAFF_ROLES.includes(actor.role) || booking.userId === actor.userId)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }
    const byPax = new Map(booking.checkIns.map((c) => [c.bookingPassengerId, c]));
    const checkIns = booking.passengers
      .map((p) => byPax.get(p.id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((row) =>
        toCheckInDto(
          row,
          `${row.bookingPassenger?.firstName ?? ''} ${row.bookingPassenger?.lastName ?? ''}`.trim(),
        ),
      );
    return { checkIns, bookingStatus: booking.status };
  }

  /** `GET /boarding-passes/:id` — one pass with its BCBP payload. */
  async getBoardingPass(actor: BookingActor, id: string): Promise<BoardingPassDto> {
    const pass = await this.prisma.boardingPass.findUnique({
      where: { id },
      include: {
        checkIn: {
          include: {
            flight: true,
            booking: { select: { id: true, userId: true } },
            bookingPassenger: { include: { ticket: { select: { ticketNumber: true } } } },
          },
        },
      },
    });
    if (!pass) throw new AppError('NOT_FOUND', 'Boarding pass not found');
    const { checkIn } = pass;
    if (!(STAFF_ROLES.includes(actor.role) || checkIn.booking.userId === actor.userId)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this boarding pass');
    }
    const pax = checkIn.bookingPassenger;
    return {
      id: pass.id,
      checkInId: pass.checkInId,
      bcbp: pass.bcbp,
      format: pass.format,
      issuedAt: pass.issuedAt.toISOString(),
      passengerName: `${pax.firstName} ${pax.lastName}`,
      ticketNumber: pax.ticket?.ticketNumber ?? null,
      flightNumber: checkIn.flight.flightNumber,
      originCode: checkIn.flight.originCode,
      destinationCode: checkIn.flight.destinationCode,
      departureUtc: checkIn.flight.scheduledDepUtc.toISOString(),
      boardingUtc: checkIn.flight.boardingUtc?.toISOString() ?? null,
      gate: checkIn.gate,
      seatLabel: checkIn.seatLabel,
      boardingSequence: checkIn.boardingSequence,
    };
  }
}
