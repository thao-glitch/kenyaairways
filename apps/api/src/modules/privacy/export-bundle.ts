import { decryptField, sha256 } from '../../common/crypto';
import { getEnv } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.module';

/**
 * Kenya DPA 2019 — right of access (§26): a complete, human-readable copy of
 * everything held about the subject. It is the subject's own data, so nothing
 * is masked; document numbers are decrypted for the copy (encryption at rest
 * protects the database, not the requester's own right to read).
 */
export async function buildExportBundle(
  prisma: PrismaService,
  userId: string,
): Promise<Record<string, unknown>> {
  const [user, profile, consents, bookings, notifications, dataRequests, auditTrail] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          role: true,
          status: true,
          locale: true,
          timezone: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.passengerProfile.findUnique({ where: { userId } }),
      prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { grantedAt: 'desc' },
      }),
      prisma.booking.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: {
          segments: {
            orderBy: { seq: 'asc' },
            include: { flight: { select: { flightNumber: true } } },
          },
          passengers: {
            orderBy: { seq: 'asc' },
            include: {
              ticket: true,
              checkIn: { include: { boardingPass: true } },
            },
          },
          payments: {
            orderBy: { createdAt: 'asc' },
            include: { refunds: { orderBy: { createdAt: 'asc' } } },
          },
        },
      }),
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          channel: true,
          templateCode: true,
          recipient: true,
          subject: true,
          body: true,
          status: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      prisma.dataSubjectRequest.findMany({ where: { userId }, orderBy: { requestedAt: 'desc' } }),
      prisma.auditLog.findMany({
        where: { actorId: userId },
        orderBy: { createdAt: 'desc' },
        take: 1_000, // the subject's own recent actions; older rows are operational detail
        select: {
          action: true,
          entityType: true,
          entityId: true,
          outcome: true,
          ip: true,
          createdAt: true,
        },
      }),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    subject: user,
    profile: profile
      ? {
          ...profile,
          docNumberEncrypted: undefined, // replaced by the decrypted copy below
          docNumber: safeDecrypt(profile.docNumberEncrypted),
        }
      : null,
    consents: consents.map((row) => ({
      purpose: row.purpose,
      policyVersion: row.policyVersion,
      granted: row.granted,
      grantedAt: row.grantedAt,
      revokedAt: row.revokedAt,
      source: row.source,
    })),
    bookings: bookings.map((booking) => ({
      pnr: booking.pnr,
      status: booking.status,
      tripType: booking.tripType,
      source: booking.source,
      currency: booking.currency,
      totalMinor: booking.totalMinor,
      contactEmail: booking.contactEmail,
      contactPhone: booking.contactPhone,
      locale: booking.locale,
      createdAt: booking.createdAt,
      confirmedAt: booking.confirmedAt,
      cancelledAt: booking.cancelledAt,
      segments: booking.segments.map((segment) => ({
        seq: segment.seq,
        flightNumber: segment.flight.flightNumber,
        originCode: segment.originCode,
        destinationCode: segment.destinationCode,
        depUtc: segment.depUtc,
        arrUtc: segment.arrUtc,
        fareMinor: segment.fareMinor,
        currency: segment.currency,
      })),
      passengers: booking.passengers.map((passenger) => ({
        seq: passenger.seq,
        type: passenger.type,
        firstName: passenger.firstName,
        lastName: passenger.lastName,
        middleName: passenger.middleName,
        dateOfBirth: passenger.dateOfBirth,
        nationality: passenger.nationality,
        countryOfResidence: passenger.countryOfResidence,
        docType: passenger.docType,
        docNumber: safeDecrypt(passenger.docNumberEncrypted),
        email: passenger.email,
        phone: passenger.phone,
        mealPreference: passenger.mealPreference,
        specialAssistance: passenger.specialAssistance,
        ticket: passenger.ticket
          ? {
              ticketNumber: passenger.ticket.ticketNumber,
              status: passenger.ticket.status,
              seatLabel: passenger.ticket.seatLabel,
              issuedAt: passenger.ticket.issuedAt,
              fareMinor: passenger.ticket.fareMinor,
              taxesMinor: passenger.ticket.taxesMinor,
              currency: passenger.ticket.currency,
            }
          : null,
        checkIn: passenger.checkIn
          ? {
              status: passenger.checkIn.status,
              seatLabel: passenger.checkIn.seatLabel,
              boardingSequence: passenger.checkIn.boardingSequence,
              gate: passenger.checkIn.gate,
              checkedInAt: passenger.checkIn.checkedInAt,
              boardingPass: passenger.checkIn.boardingPass?.bcbp ?? null,
            }
          : null,
      })),
      payments: booking.payments.map((payment) => ({
        provider: payment.provider,
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        providerRef: payment.providerRef,
        failureCode: payment.failureCode,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
        refunds: payment.refunds.map((refund) => ({
          amountMinor: refund.amountMinor,
          currency: refund.currency,
          status: refund.status,
          route: refund.route,
          reason: refund.reason,
          completedAt: refund.completedAt,
          createdAt: refund.createdAt,
        })),
      })),
    })),
    notifications,
    dataRequests: dataRequests.map((row) => ({
      type: row.type,
      status: row.status,
      requestedAt: row.requestedAt,
      processedAt: row.processedAt,
      resultKey: row.resultKey,
    })),
    auditTrail,
  };
}

/** Content digest for `DataSubjectRequest.resultKey` — no object store needed. */
export function bundleDigest(bundle: Record<string, unknown>): string {
  return `sha256:${sha256(JSON.stringify(bundle))}`;
}

/** Key rotation or a corrupt row must not break the subject's access right. */
function safeDecrypt(payload: string | null): string | null {
  if (!payload) return null;
  try {
    return decryptField(payload, getEnv().ENCRYPTION_KEY);
  } catch {
    return null;
  }
}
