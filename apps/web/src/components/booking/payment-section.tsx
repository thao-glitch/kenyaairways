'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  BookingDto,
  MpesaManualVerificationDto,
  PaymentDto,
  SiteSettingsDto,
} from '@kenyaairways/shared';
import { formatMoney, MPESA_ACCOUNT, MPESA_PAYBILL } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiRequestError, apiCall } from '@/lib/api-client';

const ACTIVE_STATUSES: readonly string[] = ['REQUIRES_ACTION', 'PENDING'];

/**
 * Pay flow: clicking Pay opens the ChoiceBank M-Pesa panel straight away
 * (paybill + account + QR + amount on screen — nothing is SMS'd), the
 * passenger pays by hand or scans the QR, then pastes the confirmation
 * message here (`POST /payments/:id/mpesa-manual`) — it is verified on the
 * spot and the booking confirms. The paybill comes from the admin payment
 * plan via the public site settings; the account and QR are the fixed
 * ChoiceBank details supplied for this account.
 */
export function PaymentSection({
  booking,
  onChanged,
}: {
  booking: Pick<BookingDto, 'id' | 'pnr' | 'status' | 'totalMinor' | 'currency'>;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState<SiteSettingsDto | null>(null);

  // Manual paybill details (paybill number lives in the payment plan).
  const [verify, setVerify] = useState<MpesaManualVerificationDto | null>(null);
  const [message, setMessage] = useState('');

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

  useEffect(() => {
    apiCall<SiteSettingsDto>('/api/v1/site-settings')
      .then(setSite)
      .catch(() => undefined);
  }, []);

  // Track an existing manual verification for the active payment.
  useEffect(() => {
    if (!payment || !ACTIVE_STATUSES.includes(payment.status)) {
      setVerify(null);
      return;
    }
    apiCall<MpesaManualVerificationDto | null>(`/api/v1/payments/${payment.id}/mpesa-manual`)
      .then(setVerify)
      .catch(() => undefined);
  }, [payment]);

  const active = payment ? ACTIVE_STATUSES.includes(payment.status) : false;
  const isManual = payment?.manual === true;
  const paybill = site?.mpesaPaybill ?? MPESA_PAYBILL;

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

  /** Manual payment: open one that settles when the passenger pastes the SMS. */
  function onStartManual(): void {
    void run(async () => {
      const created = await apiCall<PaymentDto>('/api/v1/payments', {
        method: 'POST',
        body: { bookingId: booking.id, manual: true },
      });
      setPayment(created);
    });
  }

  /** Paste the confirmation SMS → verified on the spot, booking confirms. */
  function onSubmitMessage(): void {
    if (!payment || !message.trim()) return;
    void run(async () => {
      const res = await apiCall<{
        record: MpesaManualVerificationDto;
        payment: PaymentDto;
      }>(`/api/v1/payments/${payment.id}/mpesa-manual`, {
        method: 'POST',
        body: { message: message.trim() },
      });
      setVerify(res.record);
      setPayment(res.payment);
      setMessage('');
      onChanged(); // booking confirmed — parent re-fetches
    });
  }

  /** Start a fresh manual payment after an expired/failed attempt. */
  function onRetry(): void {
    onStartManual();
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

      {active && payment && isManual ? (
        <div className="flex flex-col gap-3 rounded-md border px-3 py-3 text-sm">
          <div>
            <p className="font-medium">{t('pay.manual.title')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('pay.manual.body')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <dl className="grid grid-cols-2 gap-2 rounded-md bg-secondary/60 px-3 py-2 text-xs">
              <div>
                <dt className="text-muted-foreground">{t('pay.manual.paybill')}</dt>
                <dd className="font-mono text-sm font-semibold">{paybill}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('pay.manual.account')}</dt>
                <dd className="font-mono text-sm font-semibold">{MPESA_ACCOUNT}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('pay.manual.reference')}</dt>
                <dd className="font-mono text-sm font-semibold">{booking.pnr}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('pay.manual.amount')}</dt>
                <dd className="font-semibold">
                  {formatMoney(booking.totalMinor, booking.currency)}
                </dd>
              </div>
            </dl>
            <div className="flex flex-col items-center justify-center gap-2 rounded-md border bg-white p-3 text-center">
              <span className="text-[11px] font-semibold tracking-wide text-slate-700">
                {t('pay.manual.bank')}
              </span>
              <img
                src="/payment-qr.png"
                alt={t('pay.manual.qrAlt')}
                width={160}
                height={160}
                className="h-40 w-40"
              />
              <span className="max-w-40 text-[11px] leading-snug text-slate-600">
                {t('pay.manual.scan')}
              </span>
            </div>
          </div>

          {verify && verify.status === 'CONFIRMED' && (
            <div className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
              {t('pay.manual.confirmed', { receipt: verify.receiptNumber })}
            </div>
          )}
          {verify && verify.status === 'PENDING' && (
            <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              {t('pay.manual.pending', { receipt: verify.receiptNumber })}
            </div>
          )}
          {verify && verify.status === 'REJECTED' && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {verify.rejectReason ?? t('pay.manual.rejected')}
            </div>
          )}

          {(!verify || verify.status === 'REJECTED') && (
            <label className="flex flex-col gap-1 text-xs font-medium">
              {t('pay.manual.pasteLabel')}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder={t('pay.manual.pastePlaceholder')}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            {(!verify || verify.status === 'REJECTED') && (
              <Button size="sm" disabled={busy || !message.trim()} onClick={onSubmitMessage}>
                {busy ? t('pay.working') : t('pay.manual.submit')}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refreshPayment()}>
              {t('pay.manual.refresh')}
            </Button>
          </div>
        </div>
      ) : active && payment ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p>{t('pay.processing')}</p>
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void refreshPayment()}
            >
              {t('pay.manual.refresh')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Primary: the ChoiceBank paybill flow — no phone entry needed; the
              paybill, account, QR, PNR and amount appear as soon as Pay is tapped. */}
          <Button onClick={onStartManual} disabled={busy} className="w-full sm:w-auto">
            {busy ? t('pay.working') : t('pay.cta')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('pay.manual.intro')}</p>
        </div>
      )}

      {payment?.status === 'FAILED' && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {payment.failureMessage ?? t('pay.failed')}
          <div className="mt-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
              {t('pay.retry')}
            </Button>
          </div>
        </div>
      )}

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
