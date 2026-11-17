import type { Metadata } from 'next';
import type { BookingDto } from '@kenyaairways/shared';
import { BookingPanel } from '@/components/booking/booking-panel';
import { getTranslator } from '@/lib/i18n';
import { apiGetOrNull } from '@/lib/api';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  // Owner-scoped booking record — private, and would 404 for a crawler.
  return { title: t('booking.title'), robots: { index: false, follow: false } };
}

/**
 * Booking hub: fetches the booking server-side so it's available immediately
 * (no client-side fetch that could fail on Vercel). The panel still polls
 * for live updates.
 */
export default async function BookingPage({ params }: { params: Params }) {
  const { id } = await params;
  const { t } = await getTranslator();
  const initialBooking = await apiGetOrNull<BookingDto>(`/api/v1/bookings/${id}`);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('booking.title')}</h1>
      <BookingPanel bookingId={id} initialBooking={initialBooking} />
    </div>
  );
}
