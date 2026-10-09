import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AppError, type TicketIssueResultDto } from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { RtEventsService } from '../../realtime/rt-events.service';
import { STAFF_ROLES, type BookingActor } from '../bookings/bookings.service';
import { createLogger, maskDeep } from '../../common/logger';
import { mirrorSms } from '../notifications/mirror';
import { renderNotification } from '../notifications/templates';
import { SmsSender } from '../notifications/sms.sender';
import { toTicketDto } from './ticket-mapper';

/**
 * Ticketing (M6): turning a CONFIRMED booking into airline-issued e-tickets.
 *
 * One ticket per passenger (the schema's unique `bookingPassengerId` is the
 * authority), so `issue` is naturally idempotent — a replay returns the rows
 * that already exist instead of re-issuing. The 13-char number is the airline
 * document number (`013` + 10 digits, retried on the unique index).
 */
@Injectable()
export class TicketingService {
  private readonly log = createLogger('ticketing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly rt: RtEventsService,
    private readonly sms: SmsSender,
  ) {}

  async issue(actor: BookingActor, bookingId: string): Promise<TicketIssueResultDto> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        segments: { orderBy: { seq: 'asc' }, include: { fareClass: true } },
        passengers: { orderBy: { seq: 'asc' } },
        seatHolds: {
          where: { status: { in: ['ACTIVE', 'CONVERTED'] } },
          include: { seat: { select: { label: true } } },
        },
        tickets: { include: { bookingPassenger: true } },
      },
    });
    if (!booking) throw new AppError('NOT_FOUND', 'Booking not found');
    if (!(STAFF_ROLES.includes(actor.role) || booking.userId === actor.userId)) {
      throw new AppError('FORBIDDEN', 'You do not have access to this booking');
    }
    if (booking.tickets.length > 0) {
      return { tickets: booking.tickets.map(toTicketDto), alreadyIssued: true };
    }
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        `Tickets can only be issued for a confirmed booking — this one is ${booking.status}`,
      );
    }

    const primary = booking.segments[0]; // schema: one ticket row per passenger
    if (!primary) throw new AppError('INVALID_STATE_TRANSITION', 'Booking has no segments');

    const baseMinor = booking.segments.reduce((sum, seg) => sum + seg.fareMinor, 0);
    const taxesMinor = Math.max(0, booking.totalMinor - baseMinor); // taxes + fees
    // One seat per passenger: converted holds first (sold at payment), then
    // still-active ones. RELEASED/EXPIRED rows never carry a seat, and a
    // booking with fewer holds than passengers leaves the rest seatless —
    // check-in allocates those (or an agent assigns them earlier).
    const orderedSeats = [
      ...booking.seatHolds.filter(
        (h) => h.flightId === primary.flightId && h.status === 'CONVERTED',
      ),
      ...booking.seatHolds.filter((h) => h.flightId === primary.flightId && h.status === 'ACTIVE'),
    ];

    const tickets = await this.prisma.$transaction(async (tx) => {
      const created: Array<Awaited<ReturnType<typeof tx.ticket.create>>> = [];
      let paxSeq = 0;
      for (const pax of booking.passengers) {
        const hold = orderedSeats[paxSeq] ?? null;
        paxSeq += 1;
        let ticket: (typeof created)[number] | undefined;
        for (let attempt = 0; !ticket && attempt < 5; attempt += 1) {
          try {
            ticket = await tx.ticket.create({
              data: {
                bookingPassengerId: pax.id,
                bookingId: booking.id,
                flightId: primary.flightId,
                fareClassId: primary.fareClassId,
                seatId: hold?.seatId ?? null,
                seatLabel: hold?.seat.label ?? null,
                ticketNumber: issueTicketNumber(),
                status: 'ISSUED',
                issuedAt: new Date(),
                baggageKg: primary.fareClass.baggageKg,
                fareMinor: baseMinor,
                taxesMinor,
                currency: booking.currency,
              },
              include: { bookingPassenger: true },
            });
          } catch (err) {
            if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
              continue; // ticket number collision — retry with a fresh serial
            }
            throw err;
          }
        }
        if (!ticket) {
          throw new AppError('INTERNAL_ERROR', 'Could not allocate a unique ticket number');
        }
        created.push(ticket);
      }
      return created;
    });

    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'ticket.issue',
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'booking',
          entityId: booking.id,
          outcome: 'SUCCESS',
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: maskDeep({ pnr: booking.pnr, count: tickets.length }) as object,
        },
      });
    } catch {
      // audit must never fail the issued tickets
    }

    // In-app notice + real-time push, then the SMS mirror on the same template.
    const { subject, body } = renderNotification('ticket.issued', booking.locale, {
      pnr: booking.pnr,
      tickets: tickets.map((t) => t.ticketNumber).join(', '),
    });
    const notification = await this.prisma.notification.create({
      data: {
        userId: booking.userId,
        bookingId: booking.id,
        channel: 'INAPP',
        templateCode: 'ticket.issued',
        recipient: booking.contactEmail ?? booking.contactPhone ?? '-',
        subject,
        body,
        status: 'SENT',
        sentAt: new Date(),
      },
    });
    await this.rt.notificationNew(notification.id);
    await mirrorSms(this.prisma, this.sms, this.log, booking, 'ticket.issued', subject, body);

    return { tickets: tickets.map(toTicketDto), alreadyIssued: false };
  }
}

/** 13-char airline document number: 3-digit carrier code + 10-digit serial. */
function issueTicketNumber(): string {
  return `013${String(randomInt(0, 1_000_000_000)).padStart(10, '0')}`;
}
