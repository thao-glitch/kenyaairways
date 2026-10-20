import { Injectable } from '@nestjs/common';
import {
  AppError,
  type BaggageDto,
  type BaggageEventDto,
  type BaggageStageCode,
} from '@kenyaairways/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { STAFF_ROLES, type BookingActor } from '../bookings/bookings.service';

const STAGE_ORDER: BaggageStageCode[] = [
  'NOT_ACCEPTED',
  'ACCEPTED',
  'LOADED',
  'IN_TRANSIT',
  'LANDED',
  'ON_BELT',
];

function isAtLeast(current: BaggageStageCode, target: BaggageStageCode): boolean {
  return STAGE_ORDER.indexOf(current) >= STAGE_ORDER.indexOf(target);
}

/** Flight status + arrival timestamp → the bag's current stage (derived). */
function stageFor(status: string, actualArrUtc: Date | null): BaggageStageCode {
  if (status === 'LANDED' || (actualArrUtc && actualArrUtc.getTime() < Date.now())) {
    return 'ON_BELT'; // landed → belt starts turning ~30 min later
  }
  if (status === 'IN_AIR' || status === 'DEPARTED') return 'IN_TRANSIT';
  if (status === 'BOARDING') return 'LOADED';
  return 'ACCEPTED';
}

/**
 * Baggage tracking (mobile). Every bag is one issued ticket on the booking;
 * its journey is derived from real check-in timestamps and live flight
 * status — never invented. Stages: ACCEPTED (ticket issued) → LOADED
 * (boarding) → IN_TRANSIT (departed) → LANDED (arrived) → ON_BELT (claim).
 */
@Injectable()
export class BaggageService {
  constructor(private readonly prisma: PrismaService) {}

  async forBooking(actor: BookingActor, bookingId: string): Promise<BaggageDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, pnr: true, userId: true },
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    if (!(STAFF_ROLES.includes(actor.role) || booking.userId === actor.userId)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }

    const tickets = await this.prisma.ticket.findMany({
      where: { bookingId },
      include: {
        bookingPassenger: { select: { firstName: true, lastName: true } },
        flight: {
          select: {
            status: true,
            flightNumber: true,
            originCode: true,
            destinationCode: true,
            actualArrUtc: true,
            boardingUtc: true,
          },
        },
      },
      orderBy: { ticketNumber: 'asc' },
    });

    const items = tickets.map((row) => {
      const flight = row.flight;
      const passengerName =
        `${row.bookingPassenger?.firstName ?? ''} ${row.bookingPassenger?.lastName ?? ''}`.trim();
      const stage = stageFor(flight.status, flight.actualArrUtc);
      const events: BaggageEventDto[] = [
        {
          code: 'ACCEPTED',
          label: `Accepted at ${flight.originCode}`,
          at: row.issuedAt?.toISOString() ?? null,
          done: true,
        },
        {
          code: 'LOADED',
          label: `Loaded onto ${flight.flightNumber}`,
          at: flight.boardingUtc?.toISOString() ?? null,
          done: isAtLeast(stage, 'LOADED'),
        },
        {
          code: 'IN_TRANSIT',
          label: `In transit to ${flight.destinationCode}`,
          at: null,
          done: isAtLeast(stage, 'IN_TRANSIT'),
        },
        {
          code: 'LANDED',
          label: `Landed at ${flight.destinationCode}`,
          at: flight.actualArrUtc?.toISOString() ?? null,
          done: isAtLeast(stage, 'LANDED'),
        },
        {
          code: 'ON_BELT',
          label: `On the baggage belt at ${flight.destinationCode}`,
          at: null,
          done: isAtLeast(stage, 'ON_BELT'),
        },
      ];
      return {
        ticketNumber: row.ticketNumber,
        passengerName,
        weightKg: row.baggageKg,
        originCode: flight.originCode,
        destinationCode: flight.destinationCode,
        flightNumber: flight.flightNumber,
        events,
        current: stage,
      };
    });

    return { bookingId: booking.id, pnr: booking.pnr, items };
  }
}
