'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { formatMoney, type AdminBookingSummaryDto } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';

const statusVariant = (status: string): 'success' | 'warning' | 'destructive' | 'default' => {
  if (status === 'CONFIRMED' || status === 'CHECKED_IN') return 'success';
  if (status === 'HELD' || status === 'PENDING_PAYMENT') return 'warning';
  if (status === 'CANCELLED' || status === 'EXPIRED') return 'destructive';
  return 'default';
};

interface PayForm {
  bookingId: string;
  provider: string;
  reference: string;
}

/**
 * Assistance desk: search any booking, take payment directly at the counter
 * (settles + confirms through the normal funnel) and issue tickets — the
 * whole walk-up journey without leaving the console.
 */
export function BookingsConsole() {
  const { t } = useT();
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<AdminBookingSummaryDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayForm | null>(null);

  async function search(q?: string): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
      const res = await apiCall<AdminBookingSummaryDto[]>(`/api/v1/admin/bookings${qs}`);
      setRows(res);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void search();
  }, []);

  function submitSearch(event: FormEvent): void {
    event.preventDefault();
    void search(term);
  }

  async function recordPayment(event: FormEvent): Promise<void> {
    if (!paying) return;
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiCall(`/api/v1/admin/bookings/${paying.bookingId}/pay`, {
        method: 'POST',
        body: {
          provider: paying.provider,
          reference: paying.reference.trim() || undefined,
        },
      });
      setPaying(null);
      setNotice(`${paying.bookingId} · ${t('staff.bookings.paid.yes')}`);
      await search(term);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  async function issueTickets(bookingId: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall<{ tickets: unknown[] }>('/api/v1/ticketing/issue', {
        method: 'POST',
        body: { bookingId },
      });
      setNotice(`${t('staff.bookings.issued')} (${res.tickets.length})`);
      await search(term);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('staff.bookings.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('staff.bookings.subtitle')}</p>
      </div>

      <form onSubmit={submitSearch} className="flex gap-2">
        <Input
          aria-label={t('staff.bookings.search')}
          placeholder={t('staff.bookings.search')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {t('staff.bookings.search.action')}
        </Button>
      </form>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.bookings.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('staff.bookings.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('staff.bookings.col.pnr')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.bookings.col.passengers')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.bookings.col.route')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.bookings.col.total')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.bookings.col.status')}</th>
                    <th className="py-2 font-medium">{t('staff.bookings.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => (
                    <tr key={b.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 font-mono">{b.pnr}</td>
                      <td className="py-2 pr-3">
                        {b.passengerNames.join(', ') || '—'}
                        <div className="text-xs text-muted-foreground">
                          {b.flightNumbers.join(' · ')}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{b.route}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {formatMoney(b.totalMinor, b.currency)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={statusVariant(b.status)}>{b.status}</Badge>{' '}
                        <Badge variant={b.paid ? 'success' : 'warning'}>
                          {b.paid ? t('staff.bookings.paid.yes') : t('staff.bookings.paid.no')}
                        </Badge>
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {!b.paid && (b.status === 'HELD' || b.status === 'PENDING_PAYMENT') ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                setPaying({ bookingId: b.id, provider: 'CASH', reference: '' })
                              }
                              disabled={busy}
                            >
                              {t('staff.bookings.pay')}
                            </Button>
                          ) : null}
                          {b.status === 'CONFIRMED' || b.paid ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void issueTickets(b.id)}
                              disabled={busy}
                            >
                              {t('staff.bookings.issue')}
                            </Button>
                          ) : null}
                          {paying?.bookingId === b.id ? (
                            <form
                              onSubmit={(e) => void recordPayment(e)}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <select
                                aria-label={t('staff.bookings.pay')}
                                className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
                                value={paying.provider}
                                onChange={(e) => setPaying({ ...paying, provider: e.target.value })}
                              >
                                <option value="CASH">CASH</option>
                                <option value="MPESA_STK">M-PESA</option>
                                <option value="STRIPE">CARD</option>
                              </select>
                              <Input
                                className="h-8 w-36"
                                placeholder={t('staff.bookings.reference')}
                                value={paying.reference}
                                onChange={(e) =>
                                  setPaying({ ...paying, reference: e.target.value })
                                }
                              />
                              <Button size="sm" type="submit" disabled={busy}>
                                {t('staff.pricing.save')}
                              </Button>
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() => setPaying(null)}
                                disabled={busy}
                              >
                                {t('staff.pricing.cancel')}
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
