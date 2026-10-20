'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BookingDto, PnrLookupDto, TicketDto } from '@kenyaairways/shared';
import { formatMoney } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { formatDurationShort, formatRemaining } from '@/lib/format';
import { useRealtime, type RtEventName } from '@/lib/realtime';
import { CheckInSection } from './checkin-section';
import { PaymentSection } from './payment-section';
import { SeatMap } from './seat-map';

const PAYABLE_STATUSES = ['HELD', 'PENDING_PAYMENT'];
const SEATABLE_STATUSES = ['HELD', 'PENDING_PAYMENT', 'CONFIRMED'];
const TICKETED_STATUSES = ['CONFIRMED', 'CHECKED_IN'];

type LoadError = { status: number; message: string } | null;

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (status === 'CONFIRMED' || status === 'CHECKED_IN') return 'success';
  if (status === 'HELD' || status === 'PENDING_PAYMENT') return 'warning';
  if (status === 'CANCELLED' || status === 'REFUNDED' || status === 'EXPIRED') return 'destructive';
  return 'secondary';
}

/**
 * The passenger's booking hub: status + hold countdown, M-Pesa payment, live
 * seat map, ticket issuance and check-in with boarding passes. State comes
 * from REST; Socket.IO rooms (`booking:` / `flight:`) push updates that
 * re-fetch, with an offline polling fallback while payments are in flight.
 */
export function BookingPanel({ bookingId }: { bookingId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [booking, setBooking] = useState<BookingDto | null>(null);
  const [tickets, setTickets] = useState<TicketDto[] | null>(null);
  const [error, setError] = useState<LoadError>(null);
  const [loading, setLoading] = useState(true);
  const [seatVersion, setSeatVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const fresh = await apiCall<BookingDto>(`/api/v1/bookings/${bookingId}`);
      setBooking(fresh);
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError) setError({ status: err.status, message: err.message });
      else setError({ status: 0, message: t('error.network') });
    } finally {
      setLoading(false);
    }
  }, [bookingId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Issued tickets live behind the PNR endpoint (owner-scoped).
  const status = booking?.status;
  const pnr = booking?.pnr;
  useEffect(() => {
    if (!pnr || !status || !TICKETED_STATUSES.includes(status)) return;
    let alive = true;
    apiCall<PnrLookupDto>(`/api/v1/pnr/${encodeURIComponent(pnr)}`)
      .then((res) => {
        if (alive) setTickets(res.tickets);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pnr, status]);

  // One-second tick for the hold countdown.
  const countdown = booking && PAYABLE_STATUSES.includes(booking.status) && booking.holdExpiresAt;
  useEffect(() => {
    if (!countdown) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [countdown]);

  const flightId = booking?.segments[0]?.flightId;
  const rooms = useMemo(() => {
    const list = [`booking:${bookingId}`];
    if (flightId) list.push(`flight:${flightId}`);
    return list;
  }, [bookingId, flightId]);

  const onRtEvent = useCallback(
    (event: RtEventName) => {
      if (event === 'booking.updated' || event === 'payment.updated') void refresh();
      if (event.startsWith('seat.')) setSeatVersion((v) => v + 1);
      // Notifications (SMS/email) surface in M8 — nothing to render here.
    },
    [refresh],
  );

  const rtState = useRealtime(rooms, onRtEvent);

  // Offline/fallback polling while money is on the table.
  useEffect(() => {
    if (rtState === 'online' || !booking || !PAYABLE_STATUSES.includes(booking.status)) return;
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [rtState, booking, refresh]);

  async function issueTickets(): Promise<void> {
    const res = await apiCall<{ tickets: TicketDto[] }>('/api/v1/ticketing/issue', {
      method: 'POST',
      body: { bookingId },
    });
    setTickets(res.tickets);
    await refresh();
  }

  async function onCancel(): Promise<void> {
    if (!window.confirm(t('booking.cancel.confirm'))) return;
    try {
      await apiCall(`/api/v1/bookings/${bookingId}/cancel`, {
        method: 'POST',
        body: { reason: 'Cancelled by passenger' },
      });
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) setError({ status: err.status, message: err.message });
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-32 animate-pulse rounded-xl bg-secondary" />
        <div className="h-48 animate-pulse rounded-xl bg-secondary" />
      </div>
    );
  }

  if (error && !booking) {
    if (error.status === 401) {
      return (
        <div className="mx-auto max-w-md rounded-xl border p-6 text-center text-sm">
          <p>{t('booking.needSignIn')}</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/bookings/${bookingId}`)}`}
            className="mt-3 inline-block"
          >
            <Button>{t('nav.signIn')}</Button>
          </Link>
        </div>
      );
    }
    return (
      <p
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
        role="alert"
      >
        {error.status === 403 ? t('booking.notYours') : error.message}
      </p>
    );
  }

  if (!booking) return null;

  const holdRemaining = booking.holdExpiresAt
    ? new Date(booking.holdExpiresAt).getTime() - now
    : null;
  const seatsNeeded = booking.passengers.length;
  const activeHolds = booking.seatHolds.filter(
    (h) => h.status === 'ACTIVE' && h.flightId === flightId,
  );
  const ticketsIssued = (tickets?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span className="font-mono text-lg tracking-widest">{booking.pnr}</span>
            <Badge variant={statusVariant(booking.status)}>
              {t(`booking.status.${booking.status}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-2">
            {booking.segments.map((seg) => (
              <li
                key={seg.seq}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <span className="font-medium">{seg.flightNumber}</span>
                <span>
                  {seg.originCode} → {seg.destinationCode}
                </span>
                <span className="text-muted-foreground">
                  {seg.departLocal.replace('T', ' ').slice(0, 16)}
                </span>
                <span className="text-muted-foreground">
                  {formatDurationShort(
                    Math.round(
                      (new Date(seg.arriveUtc).getTime() - new Date(seg.departUtc).getTime()) /
                        60_000,
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-lg font-semibold">
              {formatMoney(booking.totalMinor, booking.currency)}
            </span>
            <span className="text-muted-foreground">
              {t('booking.passengers', { count: booking.passengers.length })}
            </span>
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
            {booking.passengers.map((p) => (
              <li key={p.seq}>
                {p.firstName} {p.lastName}
              </li>
            ))}
          </ul>

          {holdRemaining !== null && booking.status !== 'EXPIRED' && (
            <p className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
              <span>{t('booking.holdExpires', { remaining: formatRemaining(holdRemaining) })}</span>
              {holdRemaining <= 0 && <Badge variant="destructive">{t('booking.expired')}</Badge>}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  rtState === 'online' ? 'bg-success' : 'bg-muted-foreground/50'
                }`}
              />
              {rtState === 'online' ? t('rt.live') : t('rt.polling')}
            </span>
            {PAYABLE_STATUSES.includes(booking.status) && (
              <Button size="sm" variant="ghost" onClick={() => void onCancel()}>
                {t('booking.cancel')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment */}
      {PAYABLE_STATUSES.includes(booking.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('booking.payment.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentSection booking={booking} onChanged={() => void refresh()} />
          </CardContent>
        </Card>
      )}

      {/* Tickets */}
      {TICKETED_STATUSES.includes(booking.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('booking.tickets.title')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {tickets === null ? (
              <div className="h-12 animate-pulse rounded-md bg-secondary" aria-hidden="true" />
            ) : tickets.length === 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground">{t('booking.tickets.none')}</p>
                <Button onClick={() => void issueTickets()} className="w-full sm:w-auto">
                  {t('booking.tickets.issue')}
                </Button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {tickets.map((tk) => (
                  <li
                    key={tk.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <span>{tk.passengerName}</span>
                    <span className="font-mono text-xs">{tk.ticketNumber}</span>
                    <Badge variant="outline">{t(`ticket.status.${tk.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {/* Seat map */}
      {SEATABLE_STATUSES.includes(booking.status) && flightId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t('booking.seats.title')}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {t('seat.selected', { count: activeHolds.length })} / {seatsNeeded}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SeatMap
              flightId={flightId}
              bookingId={booking.id}
              holds={booking.seatHolds}
              rtVersion={seatVersion}
              onChanged={() => {
                setSeatVersion((v) => v + 1);
                void refresh();
                router.refresh();
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Check-in */}
      {TICKETED_STATUSES.includes(booking.status) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('booking.checkin.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <CheckInSection
              bookingId={booking.id}
              status={booking.status}
              ticketsIssued={ticketsIssued}
            />
          </CardContent>
        </Card>
      )}

      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}
