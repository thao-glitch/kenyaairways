'use client';

import { useEffect, useState } from 'react';
import type { AirportDto, BoardingPassDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiRequestError, apiCall } from '@/lib/api-client';

function localTime(iso: string, timeZone: string | undefined, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
      hour12: false,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 16);
  }
}

/**
 * Printable boarding pass. Times are rendered airport-local using the
 * airport's tz (fetched once from the public airports list); the IATA BCBP
 * payload is shown in monospace for ground handling / QA inspection.
 */
export function PassPanel({ passId }: { passId: string }) {
  const { t, locale } = useT();
  const [pass, setPass] = useState<BoardingPassDto | null>(null);
  const [airports, setAirports] = useState<AirportDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiCall<BoardingPassDto>(`/api/v1/boarding-passes/${passId}`)
      .then((p) => {
        if (alive) setPass(p);
      })
      .catch((err) => {
        if (alive) {
          setError(
            err instanceof ApiRequestError
              ? err.status === 401
                ? t('pass.needSignIn')
                : err.message
              : t('error.network'),
          );
        }
      });
    apiCall<AirportDto[]>('/api/v1/airports')
      .then((list) => {
        if (alive) setAirports(list);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [passId, t]);

  if (error) {
    return (
      <p
        className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive"
        role="alert"
      >
        {error}
      </p>
    );
  }

  if (!pass) {
    return <div className="h-72 animate-pulse rounded-xl bg-secondary" aria-busy="true" />;
  }

  const tz = (code: string): string | undefined => airports?.find((a) => a.code === code)?.timezone;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Card className="print:shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>{pass.passengerName}</span>
            <Badge variant="success">{t('pass.issued')}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.flight')}</p>
            <p className="font-medium">{pass.flightNumber}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.route')}</p>
            <p className="font-medium">
              {pass.originCode} → {pass.destinationCode}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.seat')}</p>
            <p className="font-medium">{pass.seatLabel ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.gate')}</p>
            <p className="font-medium">{pass.gate ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.sequence')}</p>
            <p className="font-medium">
              {pass.boardingSequence != null ? String(pass.boardingSequence).padStart(4, '0') : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('pass.ticket')}</p>
            <p className="font-mono text-xs">{pass.ticketNumber ?? '—'}</p>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs text-muted-foreground">
              {t('pass.departure')} ({pass.originCode})
            </p>
            <p className="font-medium">
              {localTime(pass.departureUtc, tz(pass.originCode), locale)}
            </p>
          </div>
          {pass.boardingUtc && (
            <div className="col-span-2 sm:col-span-3">
              <p className="text-xs text-muted-foreground">{t('pass.boarding')}</p>
              <p className="font-medium">
                {localTime(pass.boardingUtc, tz(pass.originCode), locale)}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-xl border p-4 print:shadow-none">
        <p className="mb-2 text-xs text-muted-foreground">{t('pass.bcbp')}</p>
        <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed">
          {pass.bcbp}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">{t('pass.barcodeNote')}</p>
      </div>

      <Button onClick={() => window.print()} className="w-full print:hidden">
        {t('pass.print')}
      </Button>
    </div>
  );
}
