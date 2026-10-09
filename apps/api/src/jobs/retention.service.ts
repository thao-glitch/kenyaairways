import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module';
import { getEnv } from '../config/env';
import { createLogger } from '../common/logger';

/** Statuses whose retention clock may expire — live bookings never get trimmed. */
const TERMINAL_BOOKING_STATUSES = ['FLOWN', 'CANCELLED', 'REFUNDED', 'EXPIRED'] as const;

export interface RetentionRunResult {
  auditLogsDeleted: number;
  notificationsDeleted: number;
  bookingsAnonymised: number;
  passengersAnonymised: number;
}

/**
 * Retention sweeps for the Kenya DPA storage-limitation principle:
 *
 * - `DATA_RETENTION_LOG_DAYS` (default 365): audit logs and notifications are
 *   **deleted** — both carry identifiers and contact details.
 * - `DATA_RETENTION_BOOKING_DAYS` (default 2555 ≈ 7 years): terminal bookings
 *   keep their financial/aviation record but lose passenger **PII** (names →
 *   REMOVED, contacts, document numbers, DOB, meal/special requests).
 *
 * Idempotent by construction: it only trims rows already past their window,
 * so a replayed run changes nothing. `now` is injectable for tests.
 */
@Injectable()
export class RetentionService {
  private readonly log = createLogger('retention');

  constructor(private readonly prisma: PrismaService) {}

  async runOnce(now: Date = new Date()): Promise<RetentionRunResult> {
    const env = getEnv();
    const logCutoff = new Date(now.getTime() - env.DATA_RETENTION_LOG_DAYS * 86_400_000);
    const bookingCutoff = new Date(now.getTime() - env.DATA_RETENTION_BOOKING_DAYS * 86_400_000);

    const auditLogsDeleted = (
      await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: logCutoff } } })
    ).count;
    const notificationsDeleted = (
      await this.prisma.notification.deleteMany({ where: { createdAt: { lt: logCutoff } } })
    ).count;

    // "Still carries PII" filters make the sweep idempotent: an already
    // anonymised booking matches the age/status rule forever, but the
    // scrubbing only ever touches rows that have something left to remove.
    const stale = await this.prisma.booking.findMany({
      where: {
        createdAt: { lt: bookingCutoff },
        status: { in: [...TERMINAL_BOOKING_STATUSES] },
        OR: [
          { contactEmail: { not: null } },
          { contactPhone: { not: null } },
          { notes: { not: null } },
        ],
      },
      select: { id: true },
    });
    const stalePassengers = await this.prisma.bookingPassenger.findMany({
      where: {
        booking: {
          createdAt: { lt: bookingCutoff },
          status: { in: [...TERMINAL_BOOKING_STATUSES] },
        },
        OR: [
          { firstName: { not: 'REMOVED' } },
          { lastName: { not: 'REMOVED' } },
          { middleName: { not: null } },
          { dateOfBirth: { not: null } },
          { sex: { not: null } },
          { docNumberEncrypted: { not: null } },
          { docNumberHash: { not: null } },
          { email: { not: null } },
          { phone: { not: null } },
          { mealPreference: { not: null } },
          { specialAssistance: { not: null } },
        ],
      },
      select: { id: true },
    });

    let bookingsAnonymised = 0;
    let passengersAnonymised = 0;
    if (stale.length > 0 || stalePassengers.length > 0) {
      [bookingsAnonymised, passengersAnonymised] = await this.prisma
        .$transaction([
          this.prisma.booking.updateMany({
            where: { id: { in: stale.map((row) => row.id) } },
            data: { contactEmail: null, contactPhone: null, notes: null },
          }),
          this.prisma.bookingPassenger.updateMany({
            where: { id: { in: stalePassengers.map((row) => row.id) } },
            data: {
              firstName: 'REMOVED',
              lastName: 'REMOVED',
              middleName: null,
              dateOfBirth: null,
              sex: null,
              docNumberEncrypted: null,
              docNumberHash: null,
              docExpiry: null,
              email: null,
              phone: null,
              apisRedress: null,
              apisKnownTraveler: null,
              mealPreference: null,
              specialAssistance: null,
            },
          }),
        ])
        .then(([bookings, passengers]) => [bookings.count, passengers.count]);
    }

    const result: RetentionRunResult = {
      auditLogsDeleted,
      notificationsDeleted,
      bookingsAnonymised,
      passengersAnonymised,
    };
    this.log.info('retention sweep', { ...result });

    if (auditLogsDeleted || notificationsDeleted || bookingsAnonymised || passengersAnonymised) {
      try {
        // Evidence that the sweep ran — itself inside the retention window.
        await this.prisma.auditLog.create({
          data: {
            action: 'retention.run',
            actorRole: null,
            entityType: 'system',
            outcome: 'SUCCESS',
            metadata: { ...result },
          },
        });
      } catch {
        // audit must never fail the sweep that audits it
      }
    }
    return result;
  }
}
