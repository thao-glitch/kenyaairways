'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { CheckInDto, CheckInResultDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiCall } from '@/lib/api-client';

/**
 * Check-in action + per-passenger results. Idempotent on the API side, so the
 * button is safe to tap twice; results link straight to printable boarding
 * passes.
 */
export function CheckInSection({
  bookingId,
  status,
  ticketsIssued,
}: {
  bookingId: string;
  status: string;
  ticketsIssued: boolean;
}) {
  const { t } = useT();
  const [checkIns, setCheckIns] = useState<CheckInDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiCall<CheckInResultDto>(
        `/api/v1/check-in?bookingId=${encodeURIComponent(bookingId)}`,
      );
      setCheckIns(res.checkIns);
    } catch {
      /* empty list is the same as "nobody checked in yet" */
      setCheckIns([]);
    }
  }, [bookingId]);

  useEffect(() => {
    void refresh();
  }, [refresh, ticketsIssued]);

  async function onCheckIn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall<CheckInResultDto>('/api/v1/check-in', {
        method: 'POST',
        body: { bookingId },
      });
      setCheckIns(res.checkIns);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  if (checkIns === null) {
    return <div className="h-16 animate-pulse rounded-md bg-secondary" aria-hidden="true" />;
  }

  if (checkIns.length > 0) {
    return (
      <ul className="flex flex-col gap-2">
        {checkIns.map((ci) => (
          <li
            key={ci.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
          >
            <div className="flex flex-col">
              <span className="font-medium">{ci.passengerName}</span>
              <span className="text-xs text-muted-foreground">
                {t('checkin.seat', { seat: ci.seatLabel ?? '—' })}
                {ci.gate ? ` · ${t('checkin.gate', { gate: ci.gate })}` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="success">{t(`checkin.status.${ci.status}`)}</Badge>
              {ci.boardingPassId && (
                <Link href={`/boarding-passes/${ci.boardingPassId}`}>
                  <Button size="sm" variant="outline">
                    {t('checkin.viewPass')}
                  </Button>
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (!ticketsIssued || (status !== 'CONFIRMED' && status !== 'CHECKED_IN')) {
    return <p className="text-sm text-muted-foreground">{t('checkin.notYet')}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => void onCheckIn()} disabled={busy} className="w-full sm:w-auto">
        {busy ? t('checkin.working') : t('checkin.cta')}
      </Button>
      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
