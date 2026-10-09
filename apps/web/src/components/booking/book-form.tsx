'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { BookingDto, FareOptionDto, FlightOptionDto, PassengerType } from '@flight13/shared';
import { formatMoney, MAX_PAX_PER_BOOKING } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';

interface PassengerRow {
  type: PassengerType;
  firstName: string;
  lastName: string;
}

const newRows = (count: number): PassengerRow[] =>
  Array.from({ length: count }, () => ({
    type: 'ADULT' as PassengerType,
    firstName: '',
    lastName: '',
  }));

/**
 * Create-booking form → `POST /bookings` → redirect to the booking hub.
 * Unauthenticated visitors get bounced through `/login?next=…` (cookies are
 * set on the API origin by the time they come back).
 */
export function BookForm({ flight, fare }: { flight: FlightOptionDto; fare: FareOptionDto }) {
  const { t, locale } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<PassengerRow[]>(() => newRows(1));
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const maxPax = Math.min(MAX_PAX_PER_BOOKING, Math.max(1, fare.seatsAvailable));
  const estimate = fare.pricing.totalMinor * rows.length;

  function update(index: number, patch: Partial<PassengerRow>): void {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const booking = await apiCall<BookingDto>('/api/v1/bookings', {
        method: 'POST',
        body: {
          tripType: 'ONE_WAY',
          source: 'WEB',
          segments: [{ flightId: flight.flightId, fareClassCode: fare.fareClass.code }],
          passengers: rows.map((row) => ({
            type: row.type,
            firstName: row.firstName.trim(),
            lastName: row.lastName.trim(),
          })),
          ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
        },
      });
      router.push(`/bookings/${booking.id}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 401) {
          const next = `/book?flightId=${flight.flightId}&fare=${fare.fareClass.code}`;
          router.push(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setError(err.message);
      } else {
        setError(t('error.network'));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('book.passengers')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {rows.map((row, index) => (
            <div
              key={index}
              className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end"
            >
              <label className="flex flex-col gap-1 text-sm font-medium sm:w-36">
                {t('book.paxType')}
                <select
                  value={row.type}
                  onChange={(e) => update(index, { type: e.target.value as PassengerType })}
                  className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="ADULT">{t('book.type.adult')}</option>
                  <option value="CHILD">{t('book.type.child')}</option>
                  <option value="INFANT">{t('book.type.infant')}</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                {t('auth.firstName')}
                <Input
                  required
                  value={row.firstName}
                  onChange={(e) => update(index, { firstName: e.target.value })}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                {t('auth.lastName')}
                <Input
                  required
                  value={row.lastName}
                  onChange={(e) => update(index, { lastName: e.target.value })}
                  autoComplete="off"
                />
              </label>
              {rows.length > 1 && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={t('book.removePax')}
                >
                  ×
                </Button>
              )}
            </div>
          ))}
          {rows.length < maxPax && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setRows((prev) => [...prev, { type: 'ADULT', firstName: '', lastName: '' }])
              }
            >
              {t('book.addPax')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('book.contact')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            {t('auth.email')}
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            {t('auth.phone')}
            <Input
              type="tel"
              inputMode="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+254712345678"
              autoComplete="tel"
            />
            <span className="text-xs font-normal text-muted-foreground">
              {t('book.contact.hint')}
            </span>
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {fare.fareClass.name} × {rows.length}
          </span>
          <span className="text-lg font-semibold">
            {formatMoney(estimate, fare.pricing.currency, locale)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('book.priceNote')}</p>
        {error && (
          <p
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? t('book.working') : t('book.cta')}
        </Button>
      </div>
    </form>
  );
}
