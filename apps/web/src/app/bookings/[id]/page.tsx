import type { Metadata } from 'next';
import { BookingPanel } from '@/components/booking/booking-panel';
import { getTranslator } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getTranslator();
  return { title: t('booking.title') };
}

/**
 * Booking hub shell. The booking itself is owner-scoped, so the panel fetches
 * it client-side with the session cookies (this page only renders chrome).
 */
export default async function BookingPage({ params }: { params: Params }) {
  const { id } = await params;
  const { t } = await getTranslator();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('booking.title')}</h1>
      <BookingPanel bookingId={id} />
    </div>
  );
}
