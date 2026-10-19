'use client';

import { useState, type FormEvent } from 'react';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiRequestError, apiCall } from '@/lib/api-client';

/**
 * Walk-up assistance actions for one booking: record money taken directly
 * (settles + confirms through the normal funnel) and issue tickets. Used by
 * the agent desk and the booking directory so staff can do the whole journey
 * for a customer who pays at the counter.
 */
export function AssistActions({
  bookingId,
  status,
  onDone,
}: {
  bookingId: string;
  status: string;
  onDone?: () => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paidNow, setPaidNow] = useState(false);

  const payable = !paidNow && (status === 'HELD' || status === 'PENDING_PAYMENT');
  const issuable = paidNow || status === 'CONFIRMED' || status === 'CHECKED_IN';

  async function pay(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiCall(`/api/v1/admin/bookings/${bookingId}/pay`, {
        method: 'POST',
        body: { provider, reference: reference.trim() || undefined },
      });
      setOpen(false);
      setPaidNow(true);
      setNotice(t('staff.bookings.paid.yes'));
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  async function issue(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall<{ tickets: unknown[]; alreadyIssued?: boolean }>(
        '/api/v1/ticketing/issue',
        { method: 'POST', body: { bookingId } },
      );
      setNotice(
        res.alreadyIssued
          ? t('staff.bookings.issued')
          : `${t('staff.bookings.issued')} (${res.tickets.length})`,
      );
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  if (!payable && !issuable && !open) {
    return notice || error ? (
      <div className="flex flex-col gap-1">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
      </div>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {payable && !open ? (
          <Button size="sm" disabled={busy} onClick={() => setOpen(true)}>
            {t('staff.bookings.pay')}
          </Button>
        ) : null}
        {issuable ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void issue()}>
            {t('staff.bookings.issue')}
          </Button>
        ) : null}
      </div>
      {open ? (
        <form onSubmit={(e) => void pay(e)} className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('staff.bookings.pay')}
            className="flex h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="CASH">CASH</option>
            <option value="MPESA_STK">M-PESA</option>
            <option value="STRIPE">CARD</option>
          </select>
          <Input
            className="h-8 w-36"
            placeholder={t('staff.bookings.reference')}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <Button size="sm" type="submit" disabled={busy}>
            {t('staff.pricing.save')}
          </Button>
          <Button
            size="sm"
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            {t('staff.pricing.cancel')}
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}
    </div>
  );
}
