'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { PriceAlertDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiRequestError, apiCall } from '@/lib/api-client';

/** My price alerts — cancel a watch, jump back into a triggered fare. */
export function PriceAlertsList() {
  const { t } = useT();
  const [alerts, setAlerts] = useState<PriceAlertDto[] | null>(null);
  const [error, setError] = useState<'auth' | 'load' | null>(null);

  const load = useCallback(async () => {
    try {
      setAlerts(await apiCall<PriceAlertDto[]>('/api/v1/price-alerts'));
      setError(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setError('auth');
      else setError('load');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(id: string): Promise<void> {
    try {
      await apiCall<void>(`/api/v1/price-alerts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setAlerts((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
    } catch {
      setError('load');
    }
  }

  if (error === 'auth') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-6 text-center">
          <p className="text-sm text-muted-foreground">{t('alerts.needSignIn')}</p>
          <Link
            href="/login?next=/alerts"
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            {t('nav.signIn')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (alerts === null && error === null) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        …
      </p>
    );
  }

  if (error === 'load' || alerts === null) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t('alerts.error')}
      </p>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">{t('alerts.empty')}</p>
        <Link href="/flights" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          {t('nav.flights')}
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {alerts.map((alert) => (
        <li key={alert.id}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
                <span>
                  {alert.originCode} → {alert.destinationCode}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium ${alert.status === 'TRIGGERED' ? 'text-primary' : 'text-muted-foreground'}`}
                  >
                    {t(`alerts.status.${alert.status}`)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void cancel(alert.id)}
                    aria-label={`${t('alerts.cancel')} ${alert.originCode} ${alert.destinationCode}`}
                  >
                    {t('alerts.cancel')}
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {alert.lowestSeenMinor !== null && (
                <span className="text-muted-foreground">
                  {t('alerts.lowest')}:{' '}
                  <span className="font-medium text-foreground">
                    {(alert.lowestSeenMinor / 100).toLocaleString('en-KE', {
                      style: 'currency',
                      currency: 'KES',
                    })}
                  </span>
                </span>
              )}
              {alert.targetMinor !== null && (
                <span className="text-muted-foreground">
                  {t('alerts.target')}:{' '}
                  <span className="font-medium text-foreground">
                    {(alert.targetMinor / 100).toLocaleString('en-KE', {
                      style: 'currency',
                      currency: 'KES',
                    })}
                  </span>
                </span>
              )}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
