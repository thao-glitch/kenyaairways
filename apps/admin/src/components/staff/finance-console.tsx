'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  formatMoney,
  type LoadReportDto,
  type PaymentDto,
  type PnrLookupDto,
  type RefundDto,
  type RevenueReportDto,
  type SessionUserDto,
} from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { useStaffUser } from '@/components/staff/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { MpesaVerifier } from '@/components/staff/mpesa-verifier';

const isoDay = (offset = 0): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

type Tab = 'revenue' | 'load' | 'refund' | 'verify';

/** FINANCE/ADMIN console: revenue & load reports, OTP-gated refunds, M-Pesa verifier. */
export function FinanceConsole() {
  const user = useStaffUser();
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('revenue');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t('staff.finance.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('staff.finance.subtitle', { operator: user.firstName })}
          </p>
        </div>
        <Badge variant="outline">{user.role}</Badge>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="tablist">
        {(['revenue', 'load', 'refund', 'verify'] as Tab[]).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              tab === key ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground'
            }`}
          >
            {t(`staff.finance.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'revenue' && <RevenuePanel />}
      {tab === 'load' && <LoadPanel />}
      {tab === 'refund' && <RefundPanel user={user} />}
      {tab === 'verify' && <MpesaVerifier />}
    </div>
  );
}

function RevenuePanel() {
  const { t, locale } = useT();
  const [from, setFrom] = useState(() => isoDay(-30));
  const [to, setTo] = useState(() => isoDay(0));
  const [currency, setCurrency] = useState('KES');
  const [report, setReport] = useState<RevenueReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<RevenueReportDto>(
        `/api/v1/reports/revenue?from=${from}&to=${to}&currency=${currency}`,
      );
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [from, to, currency, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = (report?.currency ?? 'KES') as 'KES' | 'USD' | 'EUR';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('staff.finance.revenue')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.range.from')}
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.range.to')}
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.finance.currency')}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </label>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {t('staff.refresh')}
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <Skeleton className="h-40 w-full" aria-busy="true" />}

        {report && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label={t('staff.finance.gross')}
                value={formatMoney(report.totals.grossMinor, active, locale)}
              />
              <Stat
                label={t('staff.finance.refunded')}
                value={formatMoney(report.totals.refundMinor, active, locale)}
              />
              <Stat
                label={t('staff.finance.net')}
                value={formatMoney(report.totals.netMinor, active, locale)}
              />
              <Stat label={t('staff.finance.payments')} value={String(report.totals.payments)} />
            </dl>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">{t('staff.finance.col.day')}</th>
                    <th className="py-2 pr-3">{t('staff.finance.col.gross')}</th>
                    <th className="py-2 pr-3">{t('staff.finance.col.refunds')}</th>
                    <th className="py-2 pr-3">{t('staff.finance.col.net')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr key={day.day} className="border-b last:border-0">
                      <td className="py-2 pr-3">{day.day}</td>
                      <td className="py-2 pr-3">{formatMoney(day.grossMinor, active, locale)}</td>
                      <td className="py-2 pr-3">{formatMoney(day.refundMinor, active, locale)}</td>
                      <td className="py-2 pr-3 font-medium">
                        {formatMoney(day.netMinor, active, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LoadPanel() {
  const { t } = useT();
  const [from, setFrom] = useState(() => isoDay(0));
  const [to, setTo] = useState(() => isoDay(7));
  const [report, setReport] = useState<LoadReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiCall<LoadReportDto>(`/api/v1/reports/load?from=${from}&to=${to}`);
      setReport(data);
    } catch (err) {
      setReport(null);
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [from, to, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('staff.finance.load')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.range.from')}
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.range.to')}
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            {t('staff.refresh')}
          </Button>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && <Skeleton className="h-40 w-full" aria-busy="true" />}

        {report && report.rows.length === 0 && (
          <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
            {t('staff.finance.load.empty')}
          </p>
        )}

        {report && report.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t('staff.ops.col.flight')}</th>
                  <th className="py-2 pr-3">{t('staff.finance.col.route')}</th>
                  <th className="py-2 pr-3">{t('staff.finance.col.date')}</th>
                  <th className="py-2 pr-3">{t('staff.finance.col.sold')}</th>
                  <th className="py-2 pr-3">{t('staff.finance.col.loadFactor')}</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.flightId} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{row.flightNumber}</td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      {row.originCode} → {row.destinationCode}
                    </td>
                    <td className="py-2 pr-3">{row.flightDate}</td>
                    <td className="py-2 pr-3">
                      {row.seatsSold}/{row.capacity}
                    </td>
                    <td className="py-2 pr-3">
                      {row.loadFactorPct === null ? '—' : `${row.loadFactorPct}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RefundPanel({ user }: { user: SessionUserDto }) {
  const { t, locale } = useT();
  const [pnr, setPnr] = useState('');
  const [lookup, setLookup] = useState<PnrLookupDto | null>(null);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [selectedPayment, setSelectedPayment] = useState<PaymentDto | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RefundDto | null>(null);

  async function findBooking(event: FormEvent): Promise<void> {
    event.preventDefault();
    const code = pnr.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setLookup(null);
    setPayments([]);
    setSelectedPayment(null);
    try {
      const found = await apiCall<PnrLookupDto>(`/api/v1/pnr/${encodeURIComponent(code)}`);
      setLookup(found);
      const list = await apiCall<PaymentDto[]>(
        `/api/v1/payments?bookingId=${encodeURIComponent(found.booking.id)}`,
      );
      setPayments(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  async function requestOtp(): Promise<void> {
    if (!user.phone) return;
    setBusy(true);
    setError(null);
    try {
      await apiCall('/api/v1/auth/otp/request', {
        method: 'POST',
        body: { destination: user.phone, purpose: 'REFUND' },
      });
      setOtpSent(true);
      // Mock SMS mode exposes the code so a demo can complete end-to-end; a
      // real deployment (africastalking/twilio) 404s and the officer types it.
      try {
        const preview = await apiCall<{ code: string }>(
          `/api/v1/auth/otp/preview?destination=${encodeURIComponent(user.phone)}&purpose=REFUND`,
        );
        setOtp(preview.code);
      } catch {
        /* live SMS — officer reads the code from their handset */
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  async function submitRefund(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!selectedPayment) return;
    setBusy(true);
    setError(null);
    try {
      const refund = await apiCall<RefundDto>(`/api/v1/payments/${selectedPayment.id}/refund`, {
        method: 'POST',
        body: {
          otp: otp.trim(),
          ...(amount.trim() ? { amountMinor: Math.round(Number.parseFloat(amount) * 100) } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      setResult(refund);
      setOtp('');
      setOtpSent(false);
      const list = await apiCall<PaymentDto[]>(
        `/api/v1/payments?bookingId=${encodeURIComponent(refund.bookingId)}`,
      );
      setPayments(list);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  const refundable = payments.filter((p) => p.status === 'PAID');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('staff.finance.refund')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={(e) => void findBooking(e)} className="flex flex-col gap-3 sm:flex-row">
          <label className="flex-1">
            <span className="mb-1 block text-sm font-medium">{t('staff.finance.refund.pnr')}</span>
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
            <Button type="submit" disabled={busy} className="w-full sm:w-auto">
              {busy ? t('staff.working') : t('staff.finance.refund.find')}
            </Button>
          </div>
        </form>

        {!user.phone && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            {t('staff.finance.refund.noPhone')}
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
          </div>
        )}

        {lookup && refundable.length === 0 && (
          <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
            {t('staff.finance.refund.noPayments')}
          </p>
        )}

        {refundable.length > 0 && (
          <form onSubmit={(e) => void submitRefund(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('staff.finance.refund.payment')}
              <select
                value={selectedPayment?.id ?? ''}
                onChange={(e) =>
                  setSelectedPayment(refundable.find((p) => p.id === e.target.value) ?? null)
                }
                className="h-11 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">{t('staff.finance.refund.selectPayment')}</option>
                {refundable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {formatMoney(p.amountMinor, p.currency, locale)} · {p.provider}
                  </option>
                ))}
              </select>
            </label>

            {selectedPayment && (
              <>
                <div className="flex gap-3">
                  <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                    {t('staff.finance.refund.amount')}
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder={t('staff.finance.refund.amountPh', {
                        amount: formatMoney(
                          selectedPayment.amountMinor,
                          selectedPayment.currency,
                          locale,
                        ),
                      })}
                    />
                  </label>
                  <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                    {t('staff.finance.refund.reason')}
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      maxLength={280}
                    />
                  </label>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className="mb-1 block text-sm font-medium">
                      {t('staff.finance.refund.otp')}
                    </span>
                    <Input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      className="tracking-widest"
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void requestOtp()}
                    disabled={busy || !user.phone}
                    className="sm:w-auto"
                  >
                    {otpSent ? t('staff.finance.refund.resend') : t('staff.finance.refund.sendOtp')}
                  </Button>
                </div>
                {otpSent && (
                  <p className="text-xs text-muted-foreground">
                    {t('staff.finance.refund.otpSent', { destination: user.phone ?? '' })}
                  </p>
                )}

                <Button type="submit" disabled={busy || otp.trim().length !== 6}>
                  {busy ? t('staff.working') : t('staff.finance.refund.submit')}
                </Button>
              </>
            )}
          </form>
        )}

        {result && (
          <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
            {t('staff.finance.refund.success', {
              amount: formatMoney(result.amountMinor, result.currency, locale),
            })}{' '}
            <Badge variant={result.status === 'COMPLETED' ? 'success' : 'secondary'}>
              {t(`staff.refund.${result.status}`)}
            </Badge>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}
