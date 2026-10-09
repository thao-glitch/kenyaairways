'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { BookingDto, PaymentDto } from '@flight13/shared';
import { formatMoney } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { formatRemaining } from '@/lib/format';

const ACTIVE_STATUSES: readonly string[] = ['REQUIRES_ACTION', 'PENDING'];

/**
 * M-Pesa STK flow: `POST /payments` initiates the push, then we poll the
 * payment while the provider works (real-time `payment.updated` events arrive
 * through the parent's Socket.IO room and accelerate the same refresh).
 * Mock mode adds explicit result buttons so demos don't wait on a Daraja
 * callback that will never come.
 */
export function PaymentSection({
  booking,
  onChanged,
}: {
  booking: Pick<BookingDto, 'id' | 'status' | 'totalMinor' | 'currency'>;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [msisdn, setMsisdn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshPayment = useCallback(async () => {
    try {
      const list = await apiCall<PaymentDto[]>(
        `/api/v1/payments?bookingId=${encodeURIComponent(booking.id)}`,
      );
      const latest = list.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      setPayment(latest ?? null);
    } catch {
      /* parent polling covers a flaky payments list */
    }
  }, [booking.id]);

  useEffect(() => {
    void refreshPayment();
  }, [refreshPayment]);

  const active = payment ? ACTIVE_STATUSES.includes(payment.status) : false;

  // Provider-side progress → poll (RT event arrives via the parent room).
  useEffect(() => {
    if (!payment || !ACTIVE_STATUSES.includes(payment.status)) return;
    const timer = setInterval(() => {
      void apiCall<PaymentDto>(`/api/v1/payments/${payment.id}`)
        .then((fresh) => {
          setPayment(fresh);
          if (fresh.status === 'PAID' || fresh.status === 'FAILED') onChanged();
        })
        .catch(() => undefined);
    }, 2_500);
    return () => clearInterval(timer);
  }, [payment, onChanged]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  function onStart(event: FormEvent): void {
    event.preventDefault();
    void run(async () => {
      const created = await apiCall<PaymentDto>('/api/v1/payments', {
        method: 'POST',
        body: {
          bookingId: booking.id,
          ...(msisdn.trim() ? { msisdn: msisdn.trim() } : {}),
        },
      });
      setPayment(created);
    });
  }

  function onResend(): void {
    if (!payment) return;
    void run(async () => {
      const fresh = await apiCall<PaymentDto>(`/api/v1/payments/${payment.id}/stk`, {
        method: 'POST',
      });
      setPayment(fresh);
    });
  }

  function onSimulate(resultCode: number): void {
    if (!payment) return;
    void run(async () => {
      const fresh = await apiCall<PaymentDto>(`/api/v1/payments/${payment.id}/simulate`, {
        method: 'POST',
        body: { resultCode },
      });
      setPayment(fresh);
      onChanged();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-semibold">
          {formatMoney(booking.totalMinor, booking.currency)}
        </span>
        {payment && (
          <Badge
            variant={
              payment.status === 'PAID'
                ? 'success'
                : payment.status === 'FAILED' || payment.status === 'EXPIRED'
                  ? 'destructive'
                  : 'warning'
            }
          >
            {t(`pay.status.${payment.status}`)}
          </Badge>
        )}
      </div>

      {active && payment ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p>{t('pay.stk.sent')}</p>
          {payment.expiresAt && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('pay.stk.expiresIn', {
                remaining: formatRemaining(new Date(payment.expiresAt).getTime() - Date.now()),
              })}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onResend}>
              {t('pay.stk.resend')}
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate(0)}>
              {t('pay.simulate.success')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSimulate(1032)}>
              {t('pay.simulate.cancelled')}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onStart} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            {t('pay.phone')}
            <Input
              type="tel"
              inputMode="tel"
              value={msisdn}
              onChange={(e) => setMsisdn(e.target.value)}
              placeholder="+254712345678"
            />
            <span className="text-xs font-normal text-muted-foreground">{t('pay.phone.hint')}</span>
          </label>
          <Button type="submit" disabled={busy}>
            {busy ? t('pay.working') : t('pay.cta')}
          </Button>
        </form>
      )}

      {payment?.status === 'FAILED' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {payment.failureMessage ?? t('pay.failed')}
          <div className="mt-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onResend}>
              {t('pay.retry')}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('pay.mockNote')}</p>

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
