'use client';

import { useCallback, useEffect, useState } from 'react';
import { type AdminUserDto, type Paginated } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { PaymentPlans } from '@/components/staff/payment-plans';

const statusVariant = (status: string): 'success' | 'warning' | 'destructive' => {
  if (status === 'ACTIVE') return 'success';
  if (status === 'LOCKED') return 'warning';
  return 'destructive';
};

type Tab = 'directory' | 'payments';

/** ADMIN console: user directory + the runtime "payment plans" tab. */
export function AdminConsole() {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>('directory');

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">{t('staff.admin.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('staff.admin.subtitle')}</p>
      </div>

      <div className="flex gap-1 rounded-lg border p-1" role="tablist">
        {(['directory', 'payments'] as Tab[]).map((key) => (
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
