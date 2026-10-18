'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { AirportDto } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const pad2 = (n: number): string => String(n).padStart(2, '0');
const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
};

/** One-way search: origin, destination, date, passengers → `/flights?…`. */
export function SearchForm({
  airports,
  defaults,
}: {
  airports: AirportDto[];
  defaults?: { origin?: string; destination?: string; date?: string; adults?: string };
}) {
  const { t } = useT();
  const router = useRouter();
  const [origin, setOrigin] = useState(defaults?.origin ?? '');
  const [destination, setDestination] = useState(defaults?.destination ?? '');
  const [date, setDate] = useState(defaults?.date ?? '');
  const [adults, setAdults] = useState(defaults?.adults ?? '1');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: FormEvent): void {
    event.preventDefault();
    if (origin && destination && origin === destination) {
      setError(t('search.error.sameAirport'));
      return;
    }
    setError(null);
    // Every field is optional — empty ones are dropped so the results page
    // shows every matching (or all) bookable flights.
    const params = new URLSearchParams({ adults });
    if (origin) params.set('origin', origin);
    if (destination) params.set('destination', destination);
    if (date) params.set('date', date);
    router.push(`/flights?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('search.origin')}
        <select
          value={origin}
          onChange={(e) => setOrigin(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t('search.any')}</option>
          {airports.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} — {a.city}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('search.destination')}
        <select
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className="h-11 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">{t('search.any')}</option>
          {airports.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} — {a.city}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t('search.date')}
        <Input
          type="date"
          min={todayIso()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
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
