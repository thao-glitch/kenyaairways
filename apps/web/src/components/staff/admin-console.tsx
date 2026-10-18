'use client';

import { useCallback, useEffect, useState } from 'react';
import { type AdminUserDto, type HealthDto, type MetaDto, type Paginated } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { PaymentPlans } from '@/components/staff/payment-plans';
import { MpesaVerifier } from '@/components/staff/mpesa-verifier';
import { SiteAppearance } from '@/components/staff/site-appearance';

const statusVariant = (status: string): 'success' | 'warning' | 'destructive' => {
  if (status === 'ACTIVE') return 'success';
  if (status === 'LOCKED') return 'warning';
  return 'destructive';
};

type Tab = 'directory' | 'payments' | 'verify' | 'appearance' | 'status';

/** ADMIN console: user directory, payment plans, the M-Pesa verifier, site appearance and service status. */
export function AdminConsole() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('directory');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('staff.admin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('staff.admin.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border p-1" role="tablist">
        {(['directory', 'payments', 'verify', 'appearance', 'status'] as Tab[]).map((key) => (
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
            {t(`staff.admin.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'directory' && <UserDirectory />}
      {tab === 'payments' && <PaymentPlans />}
      {tab === 'verify' && <MpesaVerifier />}
      {tab === 'appearance' && <SiteAppearance />}
      {tab === 'status' && <ServiceStatus />}
    </div>
  );
}

/**
 * Service status (`GET /healthz` + `GET /api/v1/meta`) — moved here from the
 * public homepage; operational health is staff information.
 */
function ServiceStatus() {
  const { t } = useT();
  const [health, setHealth] = useState<HealthDto | null>(null);
  const [meta, setMeta] = useState<MetaDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, m] = await Promise.all([
        apiCall<HealthDto>('/healthz'),
        apiCall<MetaDto>('/api/v1/meta'),
      ]);
      setHealth(h);
      setMeta(m);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-32 rounded-xl" />
      </div>
    );
  }

  const operational = health?.status === 'ok';

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span
              aria-hidden="true"
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                operational ? 'bg-success' : 'bg-destructive'
              }`}
            />
            {t('home.status.title')}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <dl className="space-y-1">
            <div className="flex justify-between gap-2">
              <dt>{t('home.status.api')}</dt>
              <dd className={operational ? 'text-success' : 'text-destructive'}>
                {operational
                  ? `${t('home.status.operational')} · ${t('home.status.version', { version: health?.version ?? '—' })}`
                  : t('home.status.unreachable')}
              </dd>
            </div>
            {(health?.checks ?? []).map((check) => (
              <div key={check.name} className="flex justify-between gap-2">
                <dt>{check.name}</dt>
                <dd className={check.status === 'up' ? 'text-success' : 'text-destructive'}>
                  {check.status === 'up'
                    ? `${t('home.status.operational')}${
                        check.latencyMs !== undefined ? ` · ${check.latencyMs}ms` : ''
                      }`
                    : (check.detail ?? t('home.status.unreachable'))}
                </dd>
              </div>
            ))}
            {meta && (
              <>
                <div className="flex justify-between gap-2">
                  <dt>M-Pesa</dt>
                  <dd>{meta.features.mpesa.mode}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>SMS</dt>
                  <dd>{meta.features.smsProvider}</dd>
                </div>
              </>
            )}
          </dl>
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {t('pay.manual.refresh')}
            </Button>
          </div>
        </CardContent>
      </Card>

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

/** ADMIN-only user directory (`GET /admin/users`), paginated. */
function UserDirectory() {
  const { t, locale } = useT();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<AdminUserDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiCall<Paginated<AdminUserDto>>(
        `/api/v1/admin/users?page=${page}&pageSize=20`,
      );
      setData(result);
    } catch (err) {
      setData(null);
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [page, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('staff.admin.directory')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {loading && (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}

        {data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">{t('staff.admin.col.name')}</th>
                  <th className="py-2 pr-3">{t('staff.admin.col.contact')}</th>
                  <th className="py-2 pr-3">{t('staff.admin.col.role')}</th>
                  <th className="py-2 pr-3">{t('staff.admin.col.status')}</th>
                  <th className="py-2 pr-3">{t('staff.admin.col.lastLogin')}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">
                      {u.firstName} {u.lastName}
                    </td>
                    <td className="py-2 pr-3 text-muted-foreground">
                      <div>{u.email ?? '—'}</div>
                      <div className="text-xs">{u.phone ?? '—'}</div>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">{u.role}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={statusVariant(u.status)}>{u.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString(locale, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {t('staff.admin.count', { total: data?.total ?? 0 })}
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t('staff.admin.prev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!data?.hasMore || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('staff.admin.next')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
