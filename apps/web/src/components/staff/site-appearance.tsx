'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SiteImagesDto, SiteSettingsDto, SiteTheme } from '@flight13/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall } from '@/lib/api-client';
import { DEFAULT_IMAGES } from '@/lib/site-images';

const PATH = '/api/v1/admin/site-settings';

const THEMES: SiteTheme[] = ['sky', 'savanna', 'ocean', 'forest', 'midnight'];

/** Swatch pairs shown on each theme card (bg / primary). */
const SWATCH: Record<SiteTheme, [string, string]> = {
  sky: ['#ffffff', 'hsl(199 89% 34%)'],
  savanna: ['hsl(40 33% 97%)', 'hsl(24 94% 34%)'],
  ocean: ['hsl(197 40% 97%)', 'hsl(192 84% 24%)'],
  forest: ['hsl(100 25% 97%)', 'hsl(145 58% 24%)'],
  midnight: ['hsl(225 40% 8%)', 'hsl(199 85% 55%)'],
};

type Draft = {
  theme: SiteTheme;
  hero: string;
  auth: string;
  notFound: string;
  destinations: Record<string, string>;
};

function toDraft(site: SiteSettingsDto): Draft {
  return {
    theme: site.theme,
    hero: site.images.hero ?? '',
    auth: site.images.auth ?? '',
    notFound: site.images.notFound ?? '',
    destinations: { ...(site.images.destinations ?? {}) },
  };
}

function toImages(draft: Draft): SiteImagesDto {
  const destinations: Record<string, string> = {};
  for (const [code, url] of Object.entries(draft.destinations)) {
    destinations[code.trim().toUpperCase()] = url.trim();
  }
  return {
    hero: draft.hero.trim(),
    auth: draft.auth.trim(),
    notFound: draft.notFound.trim(),
    destinations,
  };
}

/**
 * ADMIN appearance console: pick the site theme and override any photograph
 * (hero, auth banner, 404, per-destination) with an https URL. Empty fields
 * restore the built-in defaults. Applied within the settings TTL — no
 * restart, no deploy.
 */
export function SiteAppearance() {
  const { t } = useT();
  const [site, setSite] = useState<SiteSettingsDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await apiCall<SiteSettingsDto>(PATH);
      setSite(result);
      setDraft(toDraft(result));
    } catch {
      setSite(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiCall<SiteSettingsDto>(PATH, {
        method: 'PATCH',
        body: { theme: draft.theme, images: toImages(draft) },
      });
      setSite(result);
      setDraft(toDraft(result));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setBusy(false);
    }
  }

  if (!site || !draft) {
    return <Skeleton className="h-40 w-full" />;
  }

  const destinationCodes = [
    ...new Set([...Object.keys(DEFAULT_IMAGES.destinations), ...Object.keys(draft.destinations)]),
  ].sort();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.appearance.theme')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {THEMES.map((theme) => {
            const [bg, primary] = SWATCH[theme];
            const selected = draft.theme === theme;
            return (
              <button
                key={theme}
                type="button"
                onClick={() => setDraft({ ...draft, theme })}
                aria-pressed={selected}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  selected ? 'border-primary ring-2 ring-ring' : 'hover:bg-accent/40'
                }`}
              >
                <span
                  aria-hidden="true"
                  className="flex h-8 w-12 items-center justify-center rounded-md border"
                  style={{ background: bg }}
                >
                  <span className="h-4 w-4 rounded-full" style={{ background: primary }} />
                </span>
                {t(`staff.appearance.theme.${theme}`)}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.appearance.images')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('staff.appearance.imagesBody')}</p>

          {(['hero', 'auth', 'notFound'] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1 text-sm font-medium">
              {t(`staff.appearance.image.${key}`)}
              <Input
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                placeholder={DEFAULT_IMAGES[key]}
              />
            </label>
          ))}

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('staff.appearance.destinations')}</span>
            <p className="text-xs text-muted-foreground">
              {t('staff.appearance.destinationsBody')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {destinationCodes.map((code) => (
                <label key={code} className="flex flex-col gap-1 text-xs font-medium">
                  {code}
                  <Input
                    value={draft.destinations[code] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        destinations: { ...draft.destinations, [code]: e.target.value },
                      })
                    }
                    placeholder={DEFAULT_IMAGES.destinations[code] ?? ''}
                    className="h-8 text-xs"
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => void onSave()}>
              {busy ? t('staff.appearance.saving') : t('staff.plan.save')}
            </Button>
            {saved && <span className="text-sm text-success">{t('staff.appearance.saved')}</span>}
            {error && (
              <span className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-sm text-destructive">
                {error}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
