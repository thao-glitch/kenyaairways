'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  formatMoney,
  type AdminFlightPriceDto,
  type BulkPriceUpdateResultDto,
} from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';

interface Filters {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
}

interface EditDraft {
  flightId: string;
  fares: { code: string; price: string }[];
}

const EMPTY: Filters = { origin: '', destination: '', dateFrom: '', dateTo: '' };

function query(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.origin.trim()) params.set('origin', filters.origin.trim().toUpperCase());
  if (filters.destination.trim())
    params.set('destination', filters.destination.trim().toUpperCase());
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Price manager: every published fare on one screen. Single edits set one
 * flight's price for all classes; the bulk tool moves a whole route/date
 * window. Both hit `Fare.baseFareMinor`, which search results read live.
 */
export function PricingConsole() {
  const { t } = useT();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AdminFlightPriceDto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [bulk, setBulk] = useState({ value: '-10' });

  const load = useCallback(
    async (f: Filters): Promise<void> => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const res = await apiCall<AdminFlightPriceDto[]>(`/api/v1/admin/flights${query(f)}`);
        setRows(res);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : t('error.network'));
        setRows([]);
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // Populate on mount — the price manager opens with every published flight.
  useEffect(() => {
    void load(EMPTY);
  }, [load]);

  async function applyFilters(event: FormEvent): Promise<void> {
    event.preventDefault();
    await load(filters);
  }

  async function savePrice(): Promise<void> {
    if (!editing) return;
    const fares = editing.fares.map((f) => ({
      fareClassCode: f.code,
      baseFareMinor: Math.round(Number(f.price.replace(/[^\d.]/g, '')) * 100),
    }));
    if (fares.some((f) => !Number.isFinite(f.baseFareMinor) || f.baseFareMinor < 1000)) {
      setError(t('staff.pricing.error'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiCall(`/api/v1/admin/flights/${editing.flightId}/fares`, {
        method: 'PATCH',
        body: { fares },
      });
      setEditing(null);
      setNotice(t('staff.pricing.saved'));
      await load(filters);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  async function applyBulk(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = Number(bulk.value);
    if (!Number.isFinite(value)) {
      setError(t('staff.pricing.error'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiCall<BulkPriceUpdateResultDto>('/api/v1/admin/flights/bulk-prices', {
        method: 'POST',
        body: {
          originCode: filters.origin.trim().toUpperCase() || undefined,
          destinationCode: filters.destination.trim().toUpperCase() || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          operation: 'ADJUST_PERCENT',
          value,
        },
      });
      setNotice(
        t('staff.pricing.bulk.done')
          .replace('{count}', String(res.flightsUpdated))
          .replace('{fares}', String(res.faresUpdated)),
      );
      await load(filters);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('staff.pricing.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('staff.pricing.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.pricing.filters')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void applyFilters(e)} className="grid gap-3 sm:grid-cols-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pf-origin">
                {t('staff.pricing.origin')}
              </label>
              <Input
                id="pf-origin"
                placeholder="NBO"
                maxLength={3}
                value={filters.origin}
                onChange={(e) => setFilters({ ...filters, origin: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pf-dest">
                {t('staff.pricing.destination')}
              </label>
              <Input
                id="pf-dest"
                placeholder="CDG"
                maxLength={3}
                value={filters.destination}
                onChange={(e) => setFilters({ ...filters, destination: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pf-from">
                {t('staff.pricing.dateFrom')}
              </label>
              <Input
                id="pf-from"
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pf-to">
                {t('staff.pricing.dateTo')}
              </label>
              <Input
                id="pf-to"
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button type="submit" disabled={busy}>
                {t('staff.pricing.apply')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setFilters(EMPTY)}
                disabled={busy}
              >
                {t('staff.pricing.reset')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.pricing.bulk.title')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('staff.pricing.bulk.help')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void applyBulk(e)} className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="pb-val">
                {t('staff.pricing.bulk.pct')}
              </label>
              <Input
                id="pb-val"
                className="w-40"
                inputMode="decimal"
                placeholder="-10"
                value={bulk.value}
                onChange={(e) => setBulk({ value: e.target.value })}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {t('staff.pricing.bulk.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-600">{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.pricing.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rows === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('staff.pricing.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('staff.pricing.col.flight')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.pricing.col.route')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.pricing.col.date')}</th>
                    <th className="py-2 pr-3 font-medium">{t('staff.pricing.col.fares')}</th>
                    <th className="py-2 font-medium">{t('staff.pricing.col.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => {
                    const isEditing = editing?.flightId === f.flightId;
                    return (
                      <tr key={f.flightId} className="border-b align-top last:border-0">
                        <td className="py-2 pr-3 font-medium">{f.flightNumber}</td>
                        <td className="py-2 pr-3">
                          {f.originCode} → {f.destinationCode}
                        </td>
                        <td className="py-2 pr-3">{f.flightDate}</td>
                        <td className="py-2 pr-3">
                          {isEditing && editing ? (
                            <span className="flex flex-wrap items-center gap-2">
                              {editing.fares.map((fa) => (
                                <label
                                  key={fa.code}
                                  className="flex items-center gap-1 text-xs font-medium"
                                >
                                  {fa.code}
                                  <Input
                                    className="h-8 w-28 tabular-nums"
                                    inputMode="numeric"
                                    value={fa.price}
                                    onChange={(e) =>
                                      setEditing({
                                        flightId: editing.flightId,
                                        fares: editing.fares.map((x) =>
                                          x.code === fa.code ? { ...x, price: e.target.value } : x,
                                        ),
                                      })
                                    }
                                  />
                                </label>
                              ))}
                            </span>
                          ) : (
                            <span className="tabular-nums">
                              {f.fares
                                .map(
                                  (fa) =>
                                    `${fa.fareClassCode} ${formatMoney(fa.baseFareMinor, fa.currency)}`,
                                )
                                .join(' · ')}
                            </span>
                          )}
                        </td>
                        <td className="py-2">
                          {isEditing ? (
                            <span className="flex items-center gap-2">
                              <Button size="sm" onClick={() => void savePrice()} disabled={busy}>
                                {t('staff.pricing.save')}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditing(null)}
                                disabled={busy}
                              >
                                {t('staff.pricing.cancel')}
                              </Button>
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setEditing({
                                  flightId: f.flightId,
                                  fares: f.fares.map((fa) => ({
                                    code: fa.fareClassCode,
                                    price: String(Math.round(fa.baseFareMinor / 100)),
                                  })),
                                })
                              }
                              disabled={busy}
                            >
                              {t('staff.pricing.edit')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
