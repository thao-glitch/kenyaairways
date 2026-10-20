'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  MpesaManualVerificationDto,
  MpesaVerifyCheckDto,
  Paginated,
} from '@kenyaairways/shared';
import { formatMoney } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';

const RECORDS = '/api/v1/admin/mpesa-verifier/records';

const statusVariant = (status: string): 'success' | 'warning' | 'destructive' => {
  if (status === 'CONFIRMED') return 'success';
  if (status === 'PENDING') return 'warning';
  return 'destructive';
};

/**
 * Manual M-Pesa payment records (FINANCE/ADMIN). Passengers settle on their
 * own — pasting the confirmation SMS confirms the payment instantly — so this
 * console is an audit trail of every verified message, plus a manual tool for
 * edge cases (paste an SMS yourself, dry-run it first, or correct a record).
 */
export function MpesaVerifier() {
  const { t, locale } = useT();
  const [message, setMessage] = useState('');
  const [pnr, setPnr] = useState('');
  const [check, setCheck] = useState<MpesaVerifyCheckDto | null>(null);
  const [records, setRecords] = useState<Paginated<MpesaManualVerificationDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiCall<Paginated<MpesaManualVerificationDto>>(`${RECORDS}?page=1`);
      setRecords(result);
      setError(null);
    } catch {
      setRecords(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  function onCheck(): void {
    void run(async () => {
      const result = await apiCall<MpesaVerifyCheckDto>('/api/v1/admin/mpesa-verifier/parse', {
        method: 'POST',
        body: { message, ...(pnr.trim() ? { pnr: pnr.trim() } : {}) },
      });
      setCheck(result);
    });
  }

  function onVerify(): void {
    void run(async () => {
      const result = await apiCall<{ record: MpesaManualVerificationDto }>(
        '/api/v1/admin/mpesa-verifier/verify',
        { method: 'POST', body: { message, ...(pnr.trim() ? { pnr: pnr.trim() } : {}) } },
      );
      setDone(t('staff.verify.done', { receipt: result.record.receiptNumber }));
      setMessage('');
      setCheck(null);
      void load();
    });
  }

  function onConfirm(id: string): void {
    void run(async () => {
      await apiCall(`${RECORDS}/${id}/confirm`, { method: 'POST' });
      setDone(t('staff.verify.approved'));
      void load();
    });
  }

  function onReject(id: string): void {
    const reason = window.prompt(t('staff.verify.rejectPrompt')) ?? '';
    if (!reason.trim()) return;
    void run(async () => {
      await apiCall(`${RECORDS}/${id}/reject`, { method: 'POST', body: { reason: reason.trim() } });
      void load();
    });
  }

  const canVerify = check !== null && check.issues.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.verify.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{t('staff.verify.body')}</p>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('staff.verify.message')}
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder={t('staff.verify.placeholder')}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('staff.verify.pnr')}
              <Input
                value={pnr}
                onChange={(e) => setPnr(e.target.value)}
                placeholder={t('staff.verify.pnrPlaceholder')}
                className="w-40"
              />
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !message.trim()}
              onClick={onCheck}
            >
              {t('staff.verify.check')}
            </Button>
            <Button size="sm" disabled={busy || !canVerify} onClick={onVerify}>
              {t('staff.verify.confirm')}
            </Button>
          </div>

          {check && (
            <div className="rounded-md border px-3 py-2 text-sm">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>
                  {t('staff.verify.receipt')}:{' '}
                  <strong className="font-mono">{check.parsed.receiptNumber ?? '—'}</strong>
                </span>
                <span>
                  {t('staff.verify.amount')}:{' '}
                  <strong>
                    {check.parsed.amountMinor !== null
                      ? formatMoney(check.parsed.amountMinor, 'KES', locale)
                      : '—'}
                  </strong>
                </span>
                <span>
                  {t('staff.verify.paybill')}: <strong>{check.parsed.paybill ?? '—'}</strong>
                </span>
                <span>
                  {t('staff.verify.phone')}: <strong>{check.parsed.msisdn ?? '—'}</strong>
                </span>
                <span>
                  {t('staff.verify.reference')}: <strong>{check.pnr ?? '—'}</strong>
                </span>
              </div>
              {check.issues.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-xs text-destructive">
                  {check.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {done && <p className="text-sm text-success">{done}</p>}
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.verify.pending')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {loading && <Skeleton className="h-16 w-full" />}
          {!loading && records && records.items.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('staff.verify.empty')}</p>
          )}
          {records && records.items.length > 0 && (
            <ul className="flex flex-col gap-2">
              {records.items.map((record) => (
                <li
                  key={record.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-mono text-xs font-semibold">{record.receiptNumber}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(record.amountMinor, record.currency, locale)}
                      {record.pnr ? ` · ${record.pnr}` : ''}
                      {record.msisdn ? ` · ${record.msisdn}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(record.status)}>{record.status}</Badge>
                    {record.status === 'PENDING' && (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => onConfirm(record.id)}>
                          {t('staff.verify.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => onReject(record.id)}
                        >
                          {t('staff.verify.reject')}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
