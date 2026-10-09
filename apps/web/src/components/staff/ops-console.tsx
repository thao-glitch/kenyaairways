'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  type FlightStatus,
  type FlightStatusDto,
  type LoadFactorRowDto,
  type ManifestDispatchDto,
  type ManifestDto,
} from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { useStaffUser } from '@/components/staff/require-role';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';

/**
 * Allowed status transitions — mirrors `FLIGHT_STATUS_FLOW` in the API so the
 * picker only offers moves the server will accept. The server remains the
 * authority; this just avoids guaranteed-409 selections.
 */
const STATUS_FLOW: Record<FlightStatus, FlightStatus[]> = {
  SCHEDULED: ['DELAYED', 'BOARDING', 'DEPARTED', 'CANCELLED'],
  DELAYED: ['SCHEDULED', 'BOARDING', 'DEPARTED', 'CANCELLED'],
  BOARDING: ['DELAYED', 'DEPARTED', 'CANCELLED'],
  DEPARTED: ['IN_AIR', 'LANDED'],
  IN_AIR: ['LANDED'],
  LANDED: [],
  CANCELLED: [],
};

const isoDay = (offset = 0): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const statusVariant = (status: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  if (status === 'LANDED' || status === 'SCHEDULED') return 'success';
  if (status === 'DELAYED' || status === 'BOARDING' || status === 'IN_AIR') return 'warning';
  if (status === 'CANCELLED') return 'destructive';
  return 'secondary';
};

const dispatchVariant = (status: string): 'success' | 'warning' | 'destructive' | 'secondary' => {
  if (status === 'DISPATCHED') return 'success';
  if (status === 'PENDING') return 'warning';
  if (status === 'FAILED') return 'destructive';
  return 'secondary';
};

/** OPS/ADMIN console: live flight board, status control, manifest & KCAA dispatch. */
export function OpsConsole() {
  const user = useStaffUser();
  const { t } = useT();
  const [from, setFrom] = useState(() => isoDay(0));
  const [to, setTo] = useState(() => isoDay(7));
  const [board, setBoard] = useState<LoadFactorRowDto[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(true);
  const [boardError, setBoardError] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setLoadingBoard(true);
    setBoardError(null);
    try {
      const report = await apiCall<{ rows: LoadFactorRowDto[] }>(
        `/api/v1/reports/load?from=${from}&to=${to}`,
      );
      setBoard(report.rows);
    } catch (err) {
      setBoard(null);
      setBoardError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoadingBoard(false);
    }
  }, [from, to, t]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t('staff.ops.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('staff.ops.subtitle', { operator: user.firstName })}
          </p>
        </div>
        <Badge variant="outline">{user.role}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.ops.board')}</CardTitle>
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
            <Button variant="outline" onClick={() => void loadBoard()} disabled={loadingBoard}>
              {t('staff.refresh')}
            </Button>
          </div>

          {boardError && (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {boardError}
            </p>
          )}

          {loadingBoard && (
            <div className="flex flex-col gap-2" aria-busy="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loadingBoard && board && board.length === 0 && (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('staff.ops.board.empty')}
            </p>
          )}

          {!loadingBoard && board && board.length > 0 && (
            <ul className="flex flex-col divide-y">
              {board.map((row) => (
                <li key={row.flightId}>
                  <button
                    type="button"
                    onClick={() => setSelected(row.flightId)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-left text-sm transition-colors hover:bg-accent/40 ${
                      selected === row.flightId ? 'bg-accent/60' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{row.flightNumber}</span>
                      <span className="text-muted-foreground">
                        {row.originCode} → {row.destinationCode}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{row.flightDate}</span>
                      <span className="text-xs text-muted-foreground">
                        {row.seatsSold}/{row.capacity}
                      </span>
                      <Badge variant={statusVariant(row.status)}>
                        {t(`flight.status.${row.status}`)}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selected && (
        <FlightWorkspace
          key={selected}
          flightId={selected}
          onStatusChanged={() => void loadBoard()}
        />
      )}
    </div>
  );
}

function FlightWorkspace({
  flightId,
  onStatusChanged,
}: {
  flightId: string;
  onStatusChanged: () => void;
}) {
  const { t, locale } = useT();
  const [status, setStatus] = useState<FlightStatusDto | null>(null);
  const [manifest, setManifest] = useState<ManifestDto | null>(null);
  const [dispatches, setDispatches] = useState<ManifestDispatchDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status editor state
  const [nextStatus, setNextStatus] = useState<FlightStatus | ''>('');
  const [gate, setGate] = useState('');
  const [delay, setDelay] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, m, d] = await Promise.all([
        apiCall<FlightStatusDto>(`/api/v1/flights/${flightId}/status`),
        apiCall<ManifestDto>(`/api/v1/ops/manifests?flightId=${flightId}`),
        apiCall<ManifestDispatchDto[]>(`/api/v1/ops/dispatches?flightId=${flightId}`),
      ]);
      setStatus(s);
      setManifest(m);
      setDispatches(d);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [flightId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const allowedNext = useMemo<FlightStatus[]>(
    () => (status ? STATUS_FLOW[status.status] : []),
    [status],
  );

  async function saveStatus(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!status) return;
    setSaving(true);
    setError(null);
    try {
      await apiCall<FlightStatusDto>(`/api/v1/ops/flights/${flightId}/status`, {
        method: 'PATCH',
        body: {
          ...(nextStatus ? { status: nextStatus } : {}),
          ...(gate.trim() ? { gate: gate.trim() } : {}),
          ...(delay.trim() ? { delayMinutes: Number.parseInt(delay, 10) || 0 } : {}),
          ...(message.trim() ? { message: message.trim() } : {}),
        },
      });
      setNextStatus('');
      setGate('');
      setDelay('');
      setMessage('');
      await refresh();
      onStatusChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setSaving(false);
    }
  }

  async function dispatchManifest(): Promise<void> {
    setDispatching(true);
    setError(null);
    try {
      await apiCall(`/api/v1/ops/manifests/${flightId}/dispatch`, { method: 'POST' });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setDispatching(false);
    }
  }

  if (loading && !status) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!status) {
    return error ? (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error}
      </p>
    ) : null;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>
              {status.flightNumber} · {status.originCode} → {status.destinationCode}
            </span>
            <Badge variant={statusVariant(status.status)}>
              {t(`flight.status.${status.status}`)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('staff.ops.gate')}</dt>
              <dd className="font-medium">{status.gate ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('staff.ops.delay')}</dt>
              <dd className="font-medium">
                {status.delayMinutes > 0
                  ? t('staff.ops.delayMin', { min: status.delayMinutes })
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('pass.departure')}</dt>
              <dd className="font-medium">
                {new Date(status.scheduledDepUtc).toLocaleString(locale, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Africa/Nairobi',
                })}
              </dd>
            </div>
          </dl>

          <form onSubmit={(e) => void saveStatus(e)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('staff.ops.setStatus')}
              <select
                value={nextStatus}
                onChange={(e) => setNextStatus(e.target.value as FlightStatus | '')}
                disabled={allowedNext.length === 0}
                className="h-11 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                <option value="">{t('staff.ops.statusKeep', { status: status.status })}</option>
                {allowedNext.map((s) => (
                  <option key={s} value={s}>
                    {t(`flight.status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                {t('staff.ops.gate')}
                <Input
                  value={gate}
                  onChange={(e) => setGate(e.target.value.toUpperCase())}
                  maxLength={8}
                  placeholder={status.gate ?? '—'}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
                {t('staff.ops.delay')}
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={delay}
                  onChange={(e) => setDelay(e.target.value)}
                  placeholder={String(status.delayMinutes)}
                />
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('staff.ops.message')}
              <Input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={280}
                placeholder={t('staff.ops.messagePh')}
              />
            </label>
            <Button type="submit" disabled={saving}>
              {saving ? t('staff.working') : t('staff.ops.apply')}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.ops.manifest')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {manifest && (
            <div className="flex flex-wrap gap-4 text-sm">
              <span>
                <span className="text-muted-foreground">{t('staff.ops.ticketed')}: </span>
                <span className="font-medium">{manifest.totals.ticketed}</span>
              </span>
              <span>
                <span className="text-muted-foreground">{t('staff.ops.checkedIn')}: </span>
                <span className="font-medium">{manifest.totals.checkedIn}</span>
              </span>
              <span>
                <span className="text-muted-foreground">{t('staff.ops.seatsAssigned')}: </span>
                <span className="font-medium">{manifest.totals.seatsAssigned}</span>
              </span>
            </div>
          )}

          {manifest && manifest.passengers.length === 0 && (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('staff.ops.manifest.empty')}
            </p>
          )}

          {manifest && manifest.passengers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3">{t('staff.ops.col.seq')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.passenger')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.pnr')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.ticket')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.seat')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.checkin')}</th>
                    <th className="py-2 pr-3">{t('staff.ops.col.baggage')}</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.passengers.map((p) => (
                    <tr key={p.ticketNumber} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-muted-foreground">{p.seq}</td>
                      <td className="py-2 pr-3 font-medium">
                        {p.lastName}, {p.firstName}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.pnr}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.ticketNumber}</td>
                      <td className="py-2 pr-3">{p.seatLabel ?? '—'}</td>
                      <td className="py-2 pr-3">
                        <Badge variant={p.checkInStatus === 'CHECKED_IN' ? 'success' : 'secondary'}>
                          {t(`checkin.status.${p.checkInStatus}`)}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">{p.baggageKg} kg</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>{t('staff.ops.kcaa')}</span>
            <Button size="sm" onClick={() => void dispatchManifest()} disabled={dispatching}>
              {dispatching ? t('staff.working') : t('staff.ops.dispatch')}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t('staff.ops.kcaaNote')}</p>
          {dispatches.length === 0 ? (
            <p className="rounded-md border px-3 py-4 text-center text-sm text-muted-foreground">
              {t('staff.ops.dispatches.empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {dispatches.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Badge variant={dispatchVariant(d.status)}>
                      {t(`staff.dispatch.${d.status}`)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(d.createdAt).toLocaleString(locale, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t('staff.ops.attempts', { count: d.attempts })}
                    {d.responseCode !== null ? ` · HTTP ${d.responseCode}` : ''}
                    {d.error ? ` · ${d.error}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
