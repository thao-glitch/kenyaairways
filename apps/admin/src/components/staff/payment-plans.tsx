'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PaymentMethodConfigDto, PaymentPlanDto } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';

const PATH = '/api/v1/admin/payment-config';
const SELECT = 'h-11 rounded-md border border-input bg-background px-3 text-sm';
const LABEL = 'flex flex-col gap-1 text-sm font-medium';

/** Settings rendered per method (mirrors the API's accepted keys). */
const SETTINGS_BY_METHOD: Record<string, string[]> = {
  MPESA_STK: [
    'mode',
    'mpesaEnv',
    'shortcode',
    'callbackBaseUrl',
    'allowedCallbackIps',
    'initiatorName',
  ],
  STRIPE: ['mode'],
  MOCK: [],
};

const SECRETS_BY_METHOD: Record<string, string[]> = {
  MPESA_STK: ['consumerKey', 'consumerSecret', 'passkey', 'securityCredential'],
  STRIPE: ['secretKey', 'webhookSecret'],
  MOCK: [],
};

/**
 * Form state for one method card: only *dirty* settings and *typed* secrets
 * are sent — untouched fields keep following the environment defaults, and a
 * blank secret input keeps the stored value (the Clear button is the only
 * way to erase one).
 */
interface Draft {
  enabled: boolean;
  settings: Record<string, string>;
  dirty: Set<string>;
  secretInput: Record<string, string>;
  secretClear: Set<string>;
}

function draftOf(method: PaymentMethodConfigDto): Draft {
  const settings: Record<string, string> = {};
  for (const key of SETTINGS_BY_METHOD[method.provider] ?? []) {
    const value = (method.settings as Record<string, string | undefined>)[key];
    if (value !== undefined) settings[key] = value;
  }
  return {
    enabled: method.enabled,
    settings,
    dirty: new Set(),
    secretInput: {},
    secretClear: new Set(),
  };
}

/** ADMIN "Payment plans" tab: runtime configuration of every payment method. */
export function PaymentPlans() {
  const { t, locale } = useT();
  const [plan, setPlan] = useState<PaymentPlanDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyPlan = useCallback((next: PaymentPlanDto) => {
    setPlan(next);
    setDrafts(Object.fromEntries(next.methods.map((m) => [m.provider, draftOf(m)])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyPlan(await apiCall<PaymentPlanDto>(PATH));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setLoading(false);
    }
  }, [applyPlan, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchDraft = (provider: string, fn: (draft: Draft) => Draft) =>
    setDrafts((prev) => (prev[provider] ? { ...prev, [provider]: fn(prev[provider]) } : prev));

  const saveDefault = async () => {
    if (!plan) return;
    setSaving('default');
    setError(null);
    setNotice(null);
    try {
      const next = await apiCall<PaymentPlanDto>(`${PATH}/default`, {
        method: 'PATCH',
        body: { defaultProvider: plan.defaultProvider },
      });
      applyPlan(next);
      setNotice(t('staff.plan.defaultSaved'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setSaving(null);
    }
  };

  const saveMethod = async (provider: string) => {
    const draft = drafts[provider];
    if (!draft) return;
    setSaving(provider);
    setError(null);
    setNotice(null);
    try {
      const settings = Object.fromEntries(
        [...draft.dirty]
          .filter((key) => key in draft.settings)
          .map((key) => [key, draft.settings[key] ?? '']),
      );
      const secrets = Object.fromEntries([
        ...Object.entries(draft.secretInput).filter(([, v]) => v.length > 0),
        ...[...draft.secretClear].map((key) => [key, '']),
      ]);
      const updated = await apiCall<PaymentMethodConfigDto>(`${PATH}/${provider}`, {
        method: 'PATCH',
        body: { enabled: draft.enabled, settings, secrets },
      });
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              methods: prev.methods.map((m) => (m.provider === updated.provider ? updated : m)),
            }
          : prev,
      );
      setDrafts((prev) => ({ ...prev, [updated.provider]: draftOf(updated) }));
      setNotice(t('staff.plan.saved'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setSaving(null);
    }
  };

  const revertMethod = async (provider: string) => {
    setSaving(provider);
    setError(null);
    setNotice(null);
    try {
      const updated = await apiCall<PaymentMethodConfigDto>(`${PATH}/${provider}`, {
        method: 'DELETE',
      });
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              methods: prev.methods.map((m) => (m.provider === updated.provider ? updated : m)),
            }
          : prev,
      );
      setDrafts((prev) => ({ ...prev, [updated.provider]: draftOf(updated) }));
      setNotice(t('staff.plan.reverted'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {plan && !plan.encryptionKeyConfigured && (
        <p className="rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {t('staff.plan.noKek')}
        </p>
      )}

      {plan && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('staff.plan.defaultTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className={`${LABEL} min-w-56`}>
              {t('staff.plan.default')}
              <select
                value={plan.defaultProvider}
                onChange={(e) =>
                  setPlan({
                    ...plan,
                    defaultProvider: e.target.value as PaymentPlanDto['defaultProvider'],
                  })
                }
                className={SELECT}
              >
                <option value="MOCK">{t('staff.plan.method.MOCK')}</option>
                <option value="MPESA_STK">M-Pesa — {t('staff.plan.stkPush')}</option>
                <option value="MPESA_C2B">M-Pesa — {t('staff.plan.c2b')}</option>
                <option value="STRIPE">{t('staff.plan.method.STRIPE')}</option>
              </select>
            </label>
            <Button size="sm" disabled={saving !== null} onClick={() => void saveDefault()}>
              {t('staff.plan.saveDefault')}
            </Button>
            <p className="w-full text-xs text-muted-foreground">{t('staff.plan.defaultHint')}</p>
          </CardContent>
        </Card>
      )}

      {plan?.methods.map((method) => {
        const draft = drafts[method.provider];
        if (!draft) return null;
        const secrets = SECRETS_BY_METHOD[method.provider] ?? [];
        const settings = SETTINGS_BY_METHOD[method.provider] ?? [];
        return (
          <Card key={method.provider}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {t(`staff.plan.method.${method.provider}`)}
                </CardTitle>
                <Badge variant={method.source === 'DATABASE' ? 'default' : 'secondary'}>
                  {t(`staff.plan.source.${method.source}`)}
                </Badge>
                <Badge variant={draft.enabled ? 'success' : 'destructive'}>
                  {draft.enabled ? t('staff.plan.enabled') : t('staff.plan.disabled')}
                </Badge>
                {method.version !== null && (
                  <span className="text-xs text-muted-foreground">v{method.version}</span>
                )}
              </div>
              {method.updatedAt && (
                <span className="text-xs text-muted-foreground">
                  {t('staff.plan.updated', {
                    when: new Date(method.updatedAt).toLocaleString(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  })}
                </span>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {method.provider === 'MPESA_STK' && (
                <p className="text-xs text-muted-foreground">{t('staff.plan.mpesaCovers')}</p>
              )}
              {method.provider === 'MOCK' && (
                <p className="text-xs text-muted-foreground">{t('staff.plan.mockNote')}</p>
              )}

              {settings.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(e) =>
                        patchDraft(method.provider, (d) => ({ ...d, enabled: e.target.checked }))
                      }
                      className="size-4 accent-primary"
                    />
                    {t('staff.plan.enabledLabel')}
                  </label>

                  <label className={LABEL}>
                    {t('staff.plan.mode')}
                    <select
                      value={draft.settings.mode ?? ''}
                      onChange={(e) =>
                        patchDraft(method.provider, (d) => ({
                          ...d,
                          settings: { ...d.settings, mode: e.target.value },
                          dirty: new Set(d.dirty).add('mode'),
                        }))
                      }
                      className={SELECT}
                    >
                      <option value="mock">{t('staff.plan.mode.mock')}</option>
                      <option value="live">{t('staff.plan.mode.live')}</option>
                    </select>
                  </label>

                  {settings.includes('mpesaEnv') && (
                    <label className={LABEL}>
                      {t('staff.plan.mpesaEnv')}
                      <select
                        value={draft.settings.mpesaEnv ?? ''}
                        onChange={(e) =>
                          patchDraft(method.provider, (d) => ({
                            ...d,
                            settings: { ...d.settings, mpesaEnv: e.target.value },
                            dirty: new Set(d.dirty).add('mpesaEnv'),
                          }))
                        }
                        className={SELECT}
                      >
                        <option value="sandbox">Sandbox</option>
                        <option value="production">{t('staff.plan.production')}</option>
                      </select>
                    </label>
                  )}

                  {settings
                    .filter((key) => !['mode', 'mpesaEnv'].includes(key))
                    .map((key) => (
                      <label key={key} className={LABEL}>
                        {t(`staff.plan.field.${key}`)}
                        <Input
                          value={draft.settings[key] ?? ''}
                          placeholder={
                            key === 'allowedCallbackIps' ? t('staff.plan.ipPlaceholder') : undefined
                          }
                          onChange={(e) =>
                            patchDraft(method.provider, (d) => ({
                              ...d,
                              settings: { ...d.settings, [key]: e.target.value },
                              dirty: new Set(d.dirty).add(key),
                            }))
                          }
                        />
                      </label>
                    ))}
                </div>
              )}

              {secrets.length > 0 && (
                <div className="flex flex-col gap-3">
                  <span className="text-sm font-semibold">{t('staff.plan.credentials')}</span>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {secrets.map((key) => {
                      const status = method.secrets[key];
                      const clearing = draft.secretClear.has(key);
                      return (
                        <div key={key} className="flex flex-col gap-1">
                          <span className="text-sm font-medium">
                            {t(`staff.plan.secret.${key}`)}
                            {status?.configured && (
                              <span className="ml-2 font-normal text-muted-foreground">
                                {status.masked}
                              </span>
                            )}
                          </span>
                          <div className="flex gap-2">
                            <Input
                              type="password"
                              autoComplete="new-password"
                              value={draft.secretInput[key] ?? ''}
                              placeholder={
                                clearing
                                  ? t('staff.plan.pendingClear')
                                  : status?.configured
                                    ? t('staff.plan.keepBlank')
                                    : t('staff.plan.notConfigured')
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                patchDraft(method.provider, (d) => {
                                  const secretInput = { ...d.secretInput };
                                  const secretClear = new Set(d.secretClear);
                                  if (value === '') {
                                    delete secretInput[key]; // blank = keep stored value
                                    secretClear.delete(key);
                                  } else {
                                    secretInput[key] = value;
                                    secretClear.delete(key);
                                  }
                                  return { ...d, secretInput, secretClear };
                                });
                              }}
                            />
                            {status?.configured && (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  patchDraft(method.provider, (d) => {
                                    const secretInput = { ...d.secretInput };
                                    const secretClear = new Set(d.secretClear);
                                    if (secretClear.has(key)) {
                                      secretClear.delete(key); // undo the pending clear
                                    } else {
                                      secretClear.add(key);
                                      delete secretInput[key];
                                    }
                                    return { ...d, secretInput, secretClear };
                                  })
                                }
                              >
                                {clearing ? t('staff.plan.undo') : t('staff.plan.clear')}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {(settings.length > 0 || secrets.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={saving !== null}
                    onClick={() => void saveMethod(method.provider)}
                  >
                    {saving === method.provider ? t('staff.plan.saving') : t('staff.plan.save')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving !== null || method.source === 'ENV'}
                    onClick={() => void revertMethod(method.provider)}
                  >
                    {t('staff.plan.revert')}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
