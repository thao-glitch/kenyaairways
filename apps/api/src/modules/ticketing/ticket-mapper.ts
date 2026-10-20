import type { TicketDto } from '@kenyaairways/shared';
import type { Ticket } from '@prisma/client';

type PassengerRef = { firstName: string; lastName: string } | null;
type TicketWithPassenger = Ticket & { bookingPassenger?: PassengerRef };

/** Maps a Ticket row to the wire contract (dates → ISO strings). */
export function toTicketDto(row: TicketWithPassenger): TicketDto {
  const pax = row.bookingPassenger;
  return {
    id: row.id,
    bookingId: row.bookingId,
    passengerId: row.bookingPassengerId,
    passengerName: pax ? `${pax.firstName} ${pax.lastName}`.trim() : '',
    flightId: row.flightId,
    seatLabel: row.seatLabel,
    ticketNumber: row.ticketNumber,
    status: row.status,
    baggageKg: row.baggageKg,
    fareMinor: row.fareMinor,
    taxesMinor: row.taxesMinor,
    currency: row.currency as TicketDto['currency'],
    issuedAt: row.issuedAt?.toISOString() ?? null,
  };
}
