'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import {
  formatMoney,
  MAX_PAX_PER_BOOKING,
  type BookingDto,
  type Currency,
  type FlightSearchResultDto,
  type PassengerType,
  type PnrLookupDto,
} from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { AssistActions } from '@/components/admin/assist-actions';

const isoDay = (offset = 1): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

interface PaxRow {
  type: PassengerType;
  firstName: string;
  lastName: string;
}

/**
 * AGENT/ADMIN booking desk. Mirrors the passenger flow but books on the
 * customer's behalf with `source: AGENT` (the passenger is not signed in), and
 * adds a staff PNR lookup that — unlike the public one — can open any booking.
 */
export function AgentConsole() {
  const { t, locale } = useT();

  // Search state
  const [origin, setOrigin] = useState('NBO');
  const [destination, setDestination] = useState('MBA');
  const [date, setDate] = useState(() => isoDay(1));
  const [adults, setAdults] = useState('1');
  const [results, setResults] = useState<FlightSearchResultDto | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Booking state
  const [selected, setSelected] = useState<{
    flightId: string;
    fareCode: string;
    totalMinor: number;
    currency: Currency;
  } | null>(null);
  const [rows, setRows] = useState<PaxRow[]>([{ type: 'ADULT', firstName: '', lastName: '' }]);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Staff PNR lookup
  const [pnr, setPnr] = useState('');
  const [lookup, setLookup] = useState<PnrLookupDto | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  async function search(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSearching(true);
    setSearchError(null);
    setResults(null);
    setSelected(null);
    try {
      const data = await apiCall<FlightSearchResultDto>(
        `/api/v1/flights/search?origin=${encodeURIComponent(origin)}` +
          `&destination=${encodeURIComponent(destination)}&date=${date}&adults=${adults}`,
      );
      setResults(data);
    } catch (err) {
      setSearchError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setSearching(false);
    }
  }

  function pick(flightId: string, fareCode: string, totalMinor: number, currency: Currency): void {
    setSelected({ flightId, fareCode, totalMinor, currency });
    setBooking(null);
    setBookingError(null);
    setRows(
      Array.from({ length: Math.max(1, Number(adults) || 1) }, () => ({
        type: 'ADULT' as PassengerType,
        firstName: '',
        lastName: '',
      })),
    );
  }

  function updateRow(index: number, patch: Partial<PaxRow>): void {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function createBooking(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const created = await apiCall<BookingDto>('/api/v1/bookings', {
        method: 'POST',
        body: {
          tripType: 'ONE_WAY',
          source: 'AGENT',
          segments: [{ flightId: selected.flightId, fareClassCode: selected.fareCode }],
          passengers: rows.map((row) => ({
            type: row.type,
            firstName: row.firstName.trim(),
            lastName: row.lastName.trim(),
          })),
          ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
          ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
        },
      });
      setBooking(created);
      setSelected(null);
    } catch (err) {
      setBookingError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBookingBusy(false);
    }
  }

  async function lookupPnr(event: FormEvent): Promise<void> {
    event.preventDefault();
    const code = pnr.trim().toUpperCase();
    if (!code) return;
    setLookupBusy(true);
    setLookupError(null);
    setLookup(null);
    try {
      const found = await apiCall<PnrLookupDto>(`/api/v1/pnr/${encodeURIComponent(code)}`);
      setLookup(found);
    } catch (err) {
      setLookupError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLookupBusy(false);
    }
  }

  const estimate = selected ? selected.totalMinor * rows.length : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('staff.agent.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('staff.agent.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.agent.bookOnBehalf')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={(e) => void search(e)} className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('search.origin')}
              <Input
                value={origin}
                onChange={(e) => setOrigin(e.target.value.toUpperCase())}
                maxLength={3}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('search.destination')}
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value.toUpperCase())}
                maxLength={3}
                className="w-24"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('search.date')}
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('search.adults')}
              <Input
                type="number"
                min={1}
                max={MAX_PAX_PER_BOOKING}
                value={adults}
                onChange={(e) => setAdults(e.target.value)}
                className="w-20"
              />
            </label>
            <Button type="submit" disabled={searching}>
              {searching ? t('pnr.working') : t('search.submit')}
            </Button>
          </form>

          {searchError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {searchError}
            </p>
          )}

          {results && results.results.length === 0 && (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('search.empty')}
            </p>
          )}

          {results && results.results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.results.map((option) => (
                <li key={option.flightId} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{option.flightNumber}</span>
                      <span className="text-muted-foreground">
                        {option.departLocal.replace('T', ' ').slice(0, 16)}
                      </span>
                    </span>
                    <Badge variant="outline">{t(`flight.status.${option.status}`)}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {option.fareOptions.map((fare) => (
                      <Button
                        key={fare.fareClass.code}
                        size="sm"
                        variant={
                          selected?.flightId === option.flightId &&
                          selected?.fareCode === fare.fareClass.code
                            ? 'default'
                            : 'outline'
                        }
                        onClick={() =>
                          pick(
                            option.flightId,
                            fare.fareClass.code,
                            fare.pricing.totalMinor,
                            fare.pricing.currency,
                          )
                        }
                      >
                        {fare.fareClass.name} ·{' '}
                        {formatMoney(fare.pricing.totalMinor, fare.pricing.currency, locale)}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('book.passengers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void createBooking(e)} className="flex flex-col gap-4">
              {rows.map((row, index) => (
                <div
                  key={index}
                  className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-end"
                >
                  <label className="flex flex-col gap-1 text-sm font-medium sm:w-36">
                    {t('book.paxType')}
                    <select
                      value={row.type}
                      onChange={(e) => updateRow(index, { type: e.target.value as PassengerType })}
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
                      onChange={(e) => updateRow(index, { firstName: e.target.value })}
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                    {t('auth.lastName')}
                    <Input
                      required
                      value={row.lastName}
                      onChange={(e) => updateRow(index, { lastName: e.target.value })}
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
              {rows.length < MAX_PAX_PER_BOOKING && (
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

              <div className="flex flex-col gap-3 sm:flex-row">
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
                </label>
              </div>

              {bookingError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {bookingError}
                </p>
              )}

              <div className="flex items-center justify-between rounded-md border p-3">
                <span className="text-sm text-muted-foreground">
                  {t('staff.agent.total', { count: rows.length })}
                </span>
                <span className="text-lg font-semibold">
                  {formatMoney(estimate, selected.currency, locale)}
                </span>
              </div>

              <Button type="submit" disabled={bookingBusy}>
                {bookingBusy ? t('book.working') : t('staff.agent.createBooking')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {booking && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">{t('staff.agent.created')}</p>
              <p className="font-mono text-lg tracking-widest">{booking.pnr}</p>
            </div>
            <AssistActions bookingId={booking.id} status={booking.status} />
            <Link href={`/bookings/${booking.id}`}>
              <Button>{t('pnr.manage')}</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.agent.lookup')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t('staff.agent.lookupNote')}</p>
          <form onSubmit={(e) => void lookupPnr(e)} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="mb-1 block text-sm font-medium">{t('pnr.label')}</span>
              <Input
                value={pnr}
                onChange={(e) => setPnr(e.target.value.toUpperCase())}
                placeholder="K3M7PN"
                maxLength={6}
                autoCapitalize="characters"
                className="tracking-widest"
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={lookupBusy} className="w-full sm:w-auto">
                {lookupBusy ? t('pnr.working') : t('pnr.submit')}
              </Button>
            </div>
          </form>

          {lookupError && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {lookupError}
            </p>
          )}

          {lookup && (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-mono tracking-widest">{lookup.booking.pnr}</span>
                <Badge variant={lookup.booking.status === 'CONFIRMED' ? 'success' : 'secondary'}>
                  {t(`booking.status.${lookup.booking.status}`)}
                </Badge>
              </div>
              <p className="mt-1 text-muted-foreground">
                {t('booking.passengers', { count: lookup.booking.passengers.length })} ·{' '}
                {formatMoney(lookup.booking.totalMinor, lookup.booking.currency, locale)}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Link href={`/bookings/${lookup.booking.id}`}>
                  <Button size="sm">{t('pnr.manage')}</Button>
                </Link>
                <AssistActions bookingId={lookup.booking.id} status={lookup.booking.status} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
