'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { PnrLookupDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';

/** PNR lookup — the PNR is a locator, so the API still requires a session. */
export function PnrLookup() {
  const { t } = useT();
  const [code, setCode] = useState('');
  const [data, setData] = useState<PnrLookupDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return;
    setBusy(true);
    setError(null);
    setAuthError(false);
    try {
      const result = await apiCall<PnrLookupDto>(`/api/v1/pnr/${encodeURIComponent(normalized)}`);
      setData(result);
    } catch (err) {
      setData(null);
      if (err instanceof ApiRequestError) {
        if (err.status === 401) {
          setAuthError(true);
        } else if (err.code === 'NOT_FOUND' || err.code === 'FORBIDDEN') {
          setError(t('pnr.error.notFound'));
        } else {
          setError(err.message);
        }
      } else {
        setError(t('error.network'));
      }
    } finally {
      setBusy(false);
    }
  }

  const booking = data?.booking;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:flex-row">
        <label className="flex-1">
          <span className="mb-1 block text-sm font-medium">{t('pnr.label')}</span>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="K3M7PN"
            maxLength={6}
            autoCapitalize="characters"
            className="tracking-widest"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={busy} className="w-full sm:w-auto">
            {busy ? t('pnr.working') : t('pnr.submit')}
          </Button>
        </div>
      </form>

      {authError && (
        <p
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          role="alert"
        >
          {t('pnr.error.signIn')}{' '}
          <Link
            href="/login?next=%2Fpnr"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('nav.signIn')}
          </Link>
        </p>
      )}
      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      {booking && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span className="font-mono tracking-widest">{booking.pnr}</span>
              <Badge variant={booking.status === 'CONFIRMED' ? 'success' : 'secondary'}>
                {t(`booking.status.${booking.status}`)}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ul className="flex flex-col gap-2">
              {booking.segments.map((seg) => (
                <li
                  key={seg.seq}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="font-medium">{seg.flightNumber}</span>
                  <span>
                    {seg.originCode} → {seg.destinationCode}
                  </span>
                  <span className="text-muted-foreground">
                    {seg.departLocal.replace('T', ' ').slice(0, 16)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-muted-foreground">
                {t('booking.passengers', { count: booking.passengers.length })}
              </span>
              <Link href={`/bookings/${booking.id}`}>
                <Button size="sm">{t('pnr.manage')}</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
