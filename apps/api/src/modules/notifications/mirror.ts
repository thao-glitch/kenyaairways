import type { PrismaService } from '../../prisma/prisma.module';
import type { Logger } from '../../common/logger';
import type { SmsSender } from './sms.sender';
import type { NotificationTemplateCode } from './templates';

interface MirrorTarget {
  userId: string | null;
  id: string;
  contactPhone: string | null;
}

/**
 * Best-effort SMS mirror of an in-app notice on the same template. Delivery
 * problems are recorded as a FAILED notification row and otherwise swallowed —
 * a carrier outage must never fail a completed ticketing or check-in flow.
 */
export async function mirrorSms(
  prisma: PrismaService,
  sms: SmsSender,
  log: Logger,
  booking: MirrorTarget,
  templateCode: NotificationTemplateCode,
  subject: string,
  body: string,
): Promise<void> {
  const phone = booking.contactPhone;
  if (!phone) return; // contact preference: only mirror when we have an MSISDN
  try {
    const { providerRef } = await sms.send(phone, body);
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        bookingId: booking.id,
        channel: 'SMS',
        templateCode,
        recipient: phone,
        subject,
        body,
        status: 'SENT',
        providerRef,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('sms mirror failed', { templateCode, bookingId: booking.id, message });
    try {
      await prisma.notification.create({
        data: {
          userId: booking.userId,
          bookingId: booking.id,
          channel: 'SMS',
          templateCode,
          recipient: phone,
          subject,
          body,
          status: 'FAILED',
          error: message.slice(0, 500),
        },
      });
    } catch {
      // even the failure record must not break the flow it mirrors
    }
  }
}
