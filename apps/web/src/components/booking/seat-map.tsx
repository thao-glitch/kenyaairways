'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Currency, SeatHoldDto, SeatMapDto, SeatMapSeatDto } from '@kenyaairways/shared';
import { formatMoney } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Live seat map for one flight: rows of A–F buttons derived from
 * `GET /flights/:id/seats`. Seats this booking holds are highlighted (tap to
 * release); free seats are tapped to hold via the booking seat endpoints.
 * `rtVersion` bumps when a `seat.*` event arrives so the map re-syncs.
 */
export function SeatMap({
  flightId,
  bookingId,
  holds,
  rtVersion,
  onChanged,
}: {
  flightId: string;
  bookingId: string;
  holds: SeatHoldDto[];
  rtVersion: number;
  onChanged: () => void;
}) {
  const { t, locale } = useT();
  const [map, setMap] = useState<SeatMapDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiCall<SeatMapDto>(`/api/v1/flights/${flightId}/seats`)
      .then((m) => {
        if (alive) {
          setMap(m);
          setError(null);
        }
      })
      .catch((err) => {
        if (alive) setError(err instanceof ApiRequestError ? err.message : t('error.network'));
      });
    return () => {
      alive = false;
    };
  }, [flightId, rtVersion, t]);

  const mySeats = useMemo(
    () => new Set(holds.filter((h) => h.status === 'ACTIVE').map((h) => h.seatLabel)),
    [holds],
  );

  const rows = useMemo(() => {
    if (!map) return [];
    const grouped = new Map<number, SeatMapSeatDto[]>();
    for (const seat of map.seats) {
      const bucket = grouped.get(seat.row) ?? [];
      bucket.push(seat);
      grouped.set(seat.row, bucket);
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([row, seats]) => ({ row, seats }));
  }, [map]);

  const hasFees = map?.seats.some((s) => s.extraFeeMinor > 0) ?? false;

  async function toggle(seat: SeatMapSeatDto): Promise<void> {
    if (busyLabel) return;
    const mine = mySeats.has(seat.label);
    if (!mine && seat.status !== 'AVAILABLE') return;
    setBusyLabel(seat.label);
    setError(null);
    try {
      if (mine) {
        await apiCall(`/api/v1/bookings/${bookingId}/seats/${encodeURIComponent(seat.label)}`, {
          method: 'DELETE',
        });
      } else {
        await apiCall(`/api/v1/bookings/${bookingId}/seats`, {
          method: 'POST',
          body: { seatLabel: seat.label },
        });
      }
      const fresh = await apiCall<SeatMapDto>(`/api/v1/flights/${flightId}/seats`);
      setMap(fresh);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
      // Someone else won the race — resync what the server says.
      try {
        setMap(await apiCall<SeatMapDto>(`/api/v1/flights/${flightId}/seats`));
      } catch {
        /* keep stale map */
      }
    } finally {
      setBusyLabel(null);
    }
  }

  if (!map) {
    return (
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-hidden="true">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-md bg-secondary" />
        ))}
        {error && <p className="col-span-full text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {map.aircraftName ? `${map.aircraftName} · ` : ''}
        {t('seat.selected', { count: mySeats.size })}
      </p>

      <div className="flex flex-col gap-1.5 overflow-x-auto rounded-lg border p-3">
        {rows.map(({ row, seats }) => (
          <div key={row} className="flex items-center gap-1.5">
            <span className="w-7 shrink-0 text-right text-[10px] text-muted-foreground">{row}</span>
            {seats.map((seat) => {
              const mine = mySeats.has(seat.label);
              const disabled = !mine && seat.status !== 'AVAILABLE';
              return (
                <button
                  key={seat.id}
                  type="button"
                  disabled={disabled || busyLabel !== null}
                  onClick={() => void toggle(seat)}
                  title={
                    mine
                      ? t('seat.mine', { seat: seat.label })
                      : seat.status === 'AVAILABLE' && seat.extraFeeMinor > 0
                        ? formatMoney(seat.extraFeeMinor, seat.currency as Currency, locale)
                        : t(`seat.status.${seat.status}`)
                  }
                  aria-label={`${seat.label} — ${t(`seat.status.${seat.status}`)}`}
                  className={cn(
                    'h-9 w-9 shrink-0 rounded-md border text-[11px] font-medium transition-colors',
                    mine
                      ? 'border-primary bg-primary text-primary-foreground ring-2 ring-primary/40'
                      : seat.status === 'AVAILABLE'
                        ? 'border-input bg-background hover:border-primary hover:bg-accent'
                        : seat.status === 'BLOCKED'
                          ? 'cursor-not-allowed border-transparent bg-muted/60 text-muted-foreground/60'
                          : 'cursor-not-allowed border-transparent bg-muted text-muted-foreground',
                    busyLabel === seat.label && 'animate-pulse',
                  )}
                >
                  {seat.letter}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-input bg-background" />
          {t('seat.status.AVAILABLE')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-primary bg-primary" />
          {t('seat.mine.short')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-muted" />
          {t('seat.status.HELD')}/{t('seat.status.OCCUPIED')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded bg-muted/60" />
          {t('seat.status.BLOCKED')}
        </span>
        {hasFees && <span>{t('seat.extraFee')}</span>}
      </div>

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
