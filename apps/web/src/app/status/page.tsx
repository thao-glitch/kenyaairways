import type { FlightStatusBoardDto } from '@flight13/shared';
import { RouteArc } from '@/components/art/route-arc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiGetOrNull } from '@/lib/api';
import { getTranslator } from '@/lib/i18n';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

function timeOnly(iso: string | null): string {
  if (!iso) return '—';
  // `...10:30:00.000Z` → show the local wall-clock the API already resolved.
  return iso.replace('T', ' ').slice(0, 16);
}

/**
 * Public flight-status board (Flighty style). A plain GET form, so it works
 * with JavaScript disabled — the lookup itself is server-rendered.
 */
export default async function StatusPage({ searchParams }: { searchParams: SearchParams }) {
  const { t } = await getTranslator();
  const params = await searchParams;
  const flightNumber = first(params.flightNumber)?.trim().toUpperCase();
  const date = first(params.date);

  const status = flightNumber
    ? await apiGetOrNull<FlightStatusBoardDto>(
        `/api/v1/flights/status-board?flightNumber=${encodeURIComponent(flightNumber)}` +
          `&date=${encodeURIComponent(date ?? '')}`,
        { cache: 'no-store' },
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight">{t('status.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('status.prompt')}</p>
      </section>

      {/* Plain GET form — no client JS needed. */}
      <Card>
        <CardContent className="pt-6">
          <form method="get" action="/status" className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-medium">
              {t('status.flightNumber')}
              <Input
                name="flightNumber"
                defaultValue={flightNumber ?? ''}
                placeholder="F13208"
                autoComplete="off"
              />
            </label>
            <label className="flex min-w-40 flex-col gap-1.5 text-sm font-medium">
              {t('status.date')}
              <Input type="date" name="date" defaultValue={date ?? ''} />
            </label>
            <Button type="submit">{t('status.submit')}</Button>
          </form>
        </CardContent>
      </Card>

      {flightNumber && !status && (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {t('status.empty')}
        </p>
      )}

      {status && (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-3">
              <span>{status.flightNumber}</span>
              <Badge variant="outline">{t(`flight.status.${status.status}`)}</Badge>
              <Badge variant={status.delayMinutes > 0 ? 'destructive' : 'secondary'}>
                {status.delayMinutes > 0
                  ? t('status.delay', { n: status.delayMinutes })
                  : t('status.onTime')}
              </Badge>
              <span className="text-sm font-normal text-muted-foreground">{status.date}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <div className="flex flex-col">
                <span className="text-lg font-semibold">{status.origin.code}</span>
                <span className="text-sm text-muted-foreground">{status.origin.city}</span>
              </div>
              <RouteArc className="h-6 min-w-20 flex-1 text-primary/70" />
              <div className="flex flex-col text-right">
                <span className="text-lg font-semibold">{status.destination.code}</span>
                <span className="text-sm text-muted-foreground">{status.destination.city}</span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">{t('status.departs')}</dt>
                <dd className="font-medium">{timeOnly(status.estimatedDepLocal)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('status.arrives')}</dt>
                <dd className="font-medium">{timeOnly(status.estimatedArrLocal)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('status.gate')}</dt>
                <dd className="font-medium">{status.gate ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">
                  {status.aircraft ? status.aircraft.code : 'Aircraft'}
                </dt>
                <dd className="font-medium">{status.aircraft?.name ?? '—'}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
