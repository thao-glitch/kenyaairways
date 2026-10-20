'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import type { BookingDto, FlightOptionDto, PassengerType } from '@kenyaairways/shared';
import { formatMoney, MAX_PAX_PER_BOOKING } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { tripTypeFrom } from '@/lib/trip';

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
 * Handles one fare choice per segment (round trip / multi-city trips arrive
 * as `flights` from the results page). Unauthenticated visitors get bounced
 * through `/login?next=…` (cookies are set on the API origin by the time
 * they come back).
 */
export function BookForm({
  flights,
  defaultFareCode,
  trip,
  defaultPax,
  nextHref,
}: {
  flights: FlightOptionDto[];
  defaultFareCode?: string;
  trip?: string;
  defaultPax?: number;
  nextHref: string;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<PassengerRow[]>(() =>
    newRows(Math.min(Math.max(defaultPax ?? 1, 1), MAX_PAX_PER_BOOKING)),
  );
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One fare family per segment; default to the requested code or the first.
  const [fareCodes, setFareCodes] = useState<string[]>(() =>
    flights.map((flight) => {
      const wanted = flight.fareOptions.find((f) => f.fareClass.code === defaultFareCode);
      return (wanted ?? flight.fareOptions[0])?.fareClass.code ?? '';
    }),
  );

  const selections = useMemo(
    () =>
      flights.map(
        (flight, i) =>
          flight.fareOptions.find((f) => f.fareClass.code === fareCodes[i]) ??
          flight.fareOptions[0],
      ),
    [flights, fareCodes],
  );

  const maxPax = Math.min(
    MAX_PAX_PER_BOOKING,
    Math.max(1, Math.min(...selections.map((f) => f?.seatsAvailable ?? 1))),
  );
  const perPaxMinor = selections.reduce((sum, f) => sum + (f?.pricing.totalMinor ?? 0), 0);
  const estimate = perPaxMinor * rows.length;
  const currency = selections[0]?.pricing.currency ?? 'KES';
  const multi = flights.length > 1;

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
          tripType: tripTypeFrom(trip, flights.length),
          source: 'WEB',
          segments: flights.map((flight, i) => ({
            flightId: flight.flightId,
            fareClassCode: fareCodes[i],
          })),
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
          router.push(`/login?next=${encodeURIComponent(nextHref)}`);
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
      {/* One fare choice per flight of the trip. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('book.flights')}</CardTitle>
          {multi && <p className="text-sm text-muted-foreground">{t('book.selectFare')}</p>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {flights.map((flight, index) => {
            const selected = selections[index];
            if (!selected) return null;
            return (
              <div key={flight.flightId} className="flex flex-col gap-3 rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {multi && (
                      <span className="text-muted-foreground">
                        {t('book.segment', { n: index + 1 })} ·{' '}
                      </span>
                    )}
                    {flight.flightNumber} · {flight.origin.code} → {flight.destination.code} ·{' '}
                    {flight.departLocal.replace('T', ' ').slice(0, 16)}
                  </span>
                  <span className="font-semibold">
                    {formatMoney(selected.pricing.totalMinor, selected.pricing.currency, locale)}
                  </span>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium sm:w-72">
                  {t('flights.fares.title')}
                  <select
                    value={fareCodes[index] ?? ''}
                    onChange={(e) =>
                      setFareCodes((prev) =>
                        prev.map((code, i) => (i === index ? e.target.value : code)),
                      )
                    }
                    className="h-11 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {flight.fareOptions.map((f) => (
                      <option key={f.fareClass.code} value={f.fareClass.code}>
                        {f.fareClass.name} —{' '}
                        {formatMoney(f.pricing.totalMinor, f.pricing.currency, locale)} ·{' '}
                        {t('flights.seatsLeft', { count: f.seatsAvailable })}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('flights.baggage', { kg: selected.fareClass.baggageKg })} ·{' '}
                  {t('flights.carryOn', { kg: selected.fareClass.carryOnKg })} ·{' '}
                  {selected.fareClass.refundable
                    ? t('flights.refundable')
                    : t('flights.nonRefundable')}
                </p>
              </div>
            );
          })}
        </CardContent>
      </Card>

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
        <div className="flex flex-col gap-1 text-sm">
          {selections.map((f, i) =>
            f ? (
              <div key={flights[i].flightId} className="flex items-center justify-between gap-3">
                <span className="truncate text-muted-foreground">
                  {multi ? `${t('book.segment', { n: i + 1 })} · ` : ''}
                  {f.fareClass.name} × {rows.length}
                </span>
                <span>
                  {formatMoney(f.pricing.totalMinor * rows.length, f.pricing.currency, locale)}
                </span>
              </div>
            ) : null,
          )}
          <div className="flex items-center justify-between border-t pt-1">
            <span className="font-medium">{t('book.total')}</span>
            <span className="text-lg font-semibold">{formatMoney(estimate, currency, locale)}</span>
          </div>
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
