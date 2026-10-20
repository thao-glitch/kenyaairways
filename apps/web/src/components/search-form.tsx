'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AirportDto } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { DatePicker, todayIso } from '@/components/ui/date-picker';
import { parseLeg, type SearchDefaults, type TripKind } from '@/lib/trip';

export type { SearchDefaults, TripKind };

type Leg = { origin: string; destination: string; date: string };

const AirportSelect = ({
  value,
  onChange,
  airports,
}: {
  value: string;
  onChange: (v: string) => void;
  airports: AirportDto[];
}) => {
  const { t } = useT();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 rounded-md border border-input bg-background px-3 text-sm"
    >
      <option value="">{t('search.any')}</option>
      {airports.map((a) => (
        <option key={a.code} value={a.code}>
          {a.code} — {a.city}
        </option>
      ))}
    </select>
  );
};

/**
 * Trip search: return / one-way / multi-city beside the fields, fast
 * month-grid calendars, up to 4 legs. Empty fields are dropped so the
 * results page can show every matching flight.
 */
export function SearchForm({
  airports,
  defaults,
}: {
  airports: AirportDto[];
  defaults?: SearchDefaults;
}) {
  const { t } = useT();
  const router = useRouter();
  const [trip, setTrip] = useState<TripKind>(
    defaults?.trip === 'oneway' || defaults?.trip === 'multicity' ? defaults.trip : 'return',
  );
  const [origin, setOrigin] = useState(defaults?.origin ?? '');
  const [destination, setDestination] = useState(defaults?.destination ?? '');
  const [date, setDate] = useState(defaults?.date ?? '');
  const [returnDate, setReturnDate] = useState(defaults?.returnDate ?? '');
  const [adults, setAdults] = useState(defaults?.adults ?? '1');
  const [legs, setLegs] = useState<Leg[]>(() => {
    const parsed = (defaults?.legs ?? []).map(parseLeg).filter((l): l is Leg => l !== null);
    if (parsed.length > 0) return parsed.slice(0, 4);
    if (defaults?.origin || defaults?.destination || defaults?.date) {
      return [
        {
          origin: defaults.origin ?? '',
          destination: defaults.destination ?? '',
          date: defaults.date ?? '',
        },
      ];
    }
    return [
      { origin: '', destination: '', date: '' },
      { origin: '', destination: '', date: '' },
    ];
  });
  const [error, setError] = useState<string | null>(null);

  const setLeg = (index: number, patch: Partial<Leg>): void => {
    setLegs((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    const params = new URLSearchParams({ adults });

    if (trip === 'multicity') {
      for (let i = 0; i < legs.length; i += 1) {
        const leg = legs[i];
        if (!leg.origin || !leg.destination || !leg.date) {
          setError(t('search.error.legIncomplete', { n: i + 1 }));
          return;
        }
        if (leg.origin === leg.destination) {
          setError(t('search.error.sameAirport'));
          return;
        }
        if (i > 0 && leg.date < legs[i - 1].date) {
          setError(t('search.error.legOrder', { n: i + 1 }));
          return;
        }
      }
      setError(null);
      params.set('trip', 'multicity');
      for (const leg of legs) params.append('leg', `${leg.origin}:${leg.destination}:${leg.date}`);
      router.push(`/flights?${params.toString()}`);
      return;
    }

    if (origin && destination && origin === destination) {
      setError(t('search.error.sameAirport'));
      return;
    }
    if (trip === 'return' && returnDate && date && returnDate < date) {
      setError(t('search.error.returnBefore'));
      return;
    }
    setError(null);
    params.set('trip', trip);
    if (origin) params.set('origin', origin);
    if (destination) params.set('destination', destination);
    if (date) params.set('date', date);
    if (trip === 'return' && returnDate) params.set('returnDate', returnDate);
    router.push(`/flights?${params.toString()}`);
  }

  const tripSelect = (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {t('search.trip')}
      <select
        value={trip}
        onChange={(e) => setTrip(e.target.value as TripKind)}
        className="h-11 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="return">{t('search.trip.return')}</option>
        <option value="oneway">{t('search.trip.oneway')}</option>
        <option value="multicity">{t('search.trip.multicity')}</option>
      </select>
    </label>
  );

  const adultsSelect = (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {t('search.adults')}
      <select
        value={adults}
        onChange={(e) => setAdults(e.target.value)}
        className="h-11 rounded-md border border-input bg-background px-3 text-sm"
      >
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
          <option key={n} value={String(n)}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      {tripSelect}

      {trip !== 'multicity' ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('search.origin')}
            <AirportSelect value={origin} onChange={setOrigin} airports={airports} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('search.destination')}
            <AirportSelect value={destination} onChange={setDestination} airports={airports} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('search.date')}
            <DatePicker value={date} onChange={setDate} label={t('search.date')} min={todayIso()} />
          </label>
          {trip === 'return' && (
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('search.returnDate')}
              <DatePicker
                value={returnDate}
                onChange={setReturnDate}
                label={t('search.returnDate')}
                min={date || todayIso()}
              />
            </label>
          )}
          {adultsSelect}
        </>
      ) : (
        <div className="flex flex-col gap-3 sm:col-span-3">
          {legs.map((leg, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('search.leg', { n: index + 1 })} · {t('search.origin')}
                <AirportSelect
                  value={leg.origin}
                  onChange={(v) => setLeg(index, { origin: v })}
                  airports={airports}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('search.destination')}
                <AirportSelect
                  value={leg.destination}
                  onChange={(v) => setLeg(index, { destination: v })}
                  airports={airports}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t('search.date')}
                <DatePicker
                  value={leg.date}
                  onChange={(iso) => setLeg(index, { date: iso })}
                  label={t('search.date')}
                  min={index > 0 ? legs[index - 1].date || todayIso() : todayIso()}
                />
              </label>
              {legs.length > 1 && (
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('search.removeLeg')}
                    onClick={() => setLegs((rows) => rows.filter((_, i) => i !== index))}
                  >
                    ✕
                  </Button>
                </div>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-end gap-3">
            {legs.length < 4 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setLegs((rows) => [...rows, { origin: '', destination: '', date: '' }])
                }
              >
                {t('search.addLeg')}
              </Button>
            )}
            {adultsSelect}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive sm:col-span-4" role="alert">
          {error}
        </p>
      )}
      <div className="sm:col-span-4">
        <Button type="submit" className="w-full sm:w-auto">
          {t('search.submit')}
        </Button>
      </div>
    </form>
  );
}
