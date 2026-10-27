'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { SiteImagesDto, SiteSettingsDto, SiteTheme } from '@kenyaairways/shared';
import { useT } from '@/components/i18n-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, apiCall, apiUpload } from '@/lib/api-client';
import { DEFAULT_IMAGES, SECTION_IMAGE_KEYS, resolveImage } from '@/lib/site-images';

/** Settings read back in full to everyone; writes are ADMIN-only + audited. */
const GET_PATH = '/api/v1/site-settings';
const PATCH_PATH = '/api/v1/admin/site-settings';
const UPLOAD_PATH = '/api/v1/admin/media';
const UPLOAD_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif';

const THEMES: SiteTheme[] = ['sky', 'savanna', 'ocean', 'forest', 'midnight', 'crimson'];

/** Swatch pairs shown on each theme card (bg / primary). */
const SWATCH: Record<SiteTheme, [string, string]> = {
  sky: ['#ffffff', 'hsl(199 89% 34%)'],
  savanna: ['hsl(40 33% 97%)', 'hsl(24 94% 34%)'],
  ocean: ['hsl(197 40% 97%)', 'hsl(192 84% 24%)'],
  forest: ['hsl(100 25% 97%)', 'hsl(145 58% 24%)'],
  midnight: ['hsl(225 40% 8%)', 'hsl(199 85% 55%)'],
  crimson: ['#ffffff', 'hsl(356 78% 48%)'],
};

type Draft = {
  theme: SiteTheme;
  appName: string;
  hero: string;
  auth: string;
  notFound: string;
  destinations: Record<string, string>;
  /** Every other image key in play: `explore`, `place:cdg`, `holiday-safari`, … */
  extra: Record<string, string>;
};

const RESERVED_IMAGE_KEYS = new Set(['hero', 'auth', 'notFound', 'destinations']);
/** Section backdrops get their own labelled row above the free-form keys. */
const SECTION_KEY_SET = new Set<string>(SECTION_IMAGE_KEYS);
const KEY_RE = /^[a-z][a-z0-9:-]{0,63}$/;

function toDraft(site: SiteSettingsDto): Draft {
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(site.images)) {
    if (!RESERVED_IMAGE_KEYS.has(key) && typeof value === 'string') extra[key] = value;
  }
  return {
    theme: site.theme,
    appName: site.appName ?? '',
    hero: site.images.hero ?? '',
    auth: site.images.auth ?? '',
    notFound: site.images.notFound ?? '',
    destinations: { ...(site.images.destinations ?? {}) },
    extra,
  };
}

function toImages(draft: Draft): SiteImagesDto {
  const destinations: Record<string, string> = {};
  for (const [code, url] of Object.entries(draft.destinations)) {
    destinations[code.trim().toUpperCase()] = url.trim();
  }
  const images: SiteImagesDto = {
    hero: draft.hero.trim(),
    auth: draft.auth.trim(),
    notFound: draft.notFound.trim(),
    destinations,
  };
  for (const [key, url] of Object.entries(draft.extra)) {
    const k = key.trim();
    if (k && !RESERVED_IMAGE_KEYS.has(k)) images[k] = url.trim();
  }
  return images;
}

/**
 * One photograph slot: the current image renders first as a preview, and
 * Upload swaps it for a file straight from the computer — no URL pasting.
 * Restore default drops the override so the built-in photo shows again.
 */
function ImageField({
  label,
  value,
  fallback,
  compact = false,
  uploading,
  onFile,
  onClear,
  onRemove,
}: {
  label: string;
  /** '' means the built-in default is in effect. */
  value: string;
  fallback?: string;
  compact?: boolean;
  uploading: boolean;
  onFile: (file: File) => void;
  onClear?: () => void;
  onRemove?: () => void;
}) {
  const { t } = useT();
  const inputId = useId();
  const preview = resolveImage(value || fallback || '');
  const box = compact ? 'h-12 w-20' : 'h-20 w-32';

  return (
    <div className={compact ? 'flex flex-col gap-1' : 'flex flex-wrap items-center gap-3'}>
      {preview ? (
        <img
          src={preview}
          alt=""
          className={`${box} shrink-0 rounded-md border object-cover bg-muted`}
        />
      ) : (
        <span aria-hidden="true" className={`${box} shrink-0 rounded-md border bg-muted`} />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-sm font-medium" title={label}>
          {label}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <label
            htmlFor={inputId}
            className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
          >
            {uploading ? t('staff.appearance.uploading') : t('staff.appearance.upload')}
            <input
              id={inputId}
              type="file"
              accept={UPLOAD_ACCEPT}
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onFile(file);
                e.target.value = '';
              }}
            />
          </label>
          {value && onClear && (
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onClear}>
              {t('staff.appearance.clear')}
            </Button>
          )}
          {onRemove && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 px-2 text-xs"
              aria-label={`${t('staff.appearance.remove')} ${label}`}
              onClick={onRemove}
            >
              ✕
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ADMIN appearance console: pick the site theme, rename the app live, and
 * replace any photograph (hero, auth banner, 404, per-destination, section
 * keys) by uploading a file. Empty slots keep the built-in defaults. Applied
 * within the settings TTL — no restart, no deploy.
 */
export function SiteAppearance() {
  const { t } = useT();
  const [site, setSite] = useState<SiteSettingsDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [newKey, setNewKey] = useState('');
  /** Draft key currently uploading (`hero`, `dest:NBO`, `extra:explore`). */
  const [uploading, setUploading] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await apiCall<SiteSettingsDto>(GET_PATH);
      setSite(result);
      setDraft(toDraft(result));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onSave(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await apiCall<SiteSettingsDto>(PATCH_PATH, {
        method: 'PATCH',
        body: {
          appName: draft.appName.trim(),
          theme: draft.theme,
          images: toImages(draft),
        },
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

  /** Upload one file, then point the draft slot at the stored photograph. */
  async function onUpload(slot: string, file: File, done?: () => void): Promise<void> {
    setUploading(slot);
    setError(null);
    try {
      const { url } = await apiUpload<{ url: string }>(UPLOAD_PATH, file);
      setDraft((d) => {
        if (!d) return d;
        if (slot.startsWith('dest:')) {
          return { ...d, destinations: { ...d.destinations, [slot.slice(5)]: url } };
        }
        if (slot.startsWith('extra:')) {
          return { ...d, extra: { ...d.extra, [slot.slice(6)]: url } };
        }
        return { ...d, [slot]: url };
      });
      done?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t('error.network'));
    } finally {
      setUploading(null);
    }
  }

  if (!site || !draft) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <Skeleton className="h-40 w-full" />
    );
  }

  const destinationCodes = [
    ...new Set([...Object.keys(DEFAULT_IMAGES.destinations), ...Object.keys(draft.destinations)]),
  ].sort();
  const clearSlot = (key: 'hero' | 'auth' | 'notFound') => (): void =>
    setDraft({ ...draft, [key]: '' });

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
          <CardTitle className="text-base">{t('staff.appearance.name')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('staff.appearance.nameBody')}</p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm font-medium">
            {t('staff.appearance.name')}
            <Input
              value={draft.appName}
              maxLength={40}
              onChange={(e) => setDraft({ ...draft, appName: e.target.value })}
              placeholder="Kenya Airways."
            />
          </label>
          <Button disabled={busy} onClick={() => void onSave()}>
            {busy ? t('staff.appearance.saving') : t('staff.appearance.save')}
          </Button>
          {saved && <span className="text-sm text-success">{t('staff.appearance.saved')}</span>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('staff.appearance.images')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t('staff.appearance.imagesBody')}</p>
          <p className="text-xs text-muted-foreground">{t('staff.appearance.uploadHint')}</p>

          {(['hero', 'auth', 'notFound'] as const).map((key) => (
            <ImageField
              key={key}
              label={t(`staff.appearance.image.${key}`)}
              value={draft[key]}
              fallback={DEFAULT_IMAGES[key]}
              uploading={uploading === key}
              onFile={(file) => void onUpload(key, file)}
              onClear={clearSlot(key)}
            />
          ))}

          {/* Section backdrops behind Explore / Plan / Manage / Experience /
              Rewards / Holidays — upload-first like every other slot. */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('staff.appearance.sections')}</span>
            <p className="text-xs text-muted-foreground">{t('staff.appearance.sectionsBody')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {SECTION_IMAGE_KEYS.map((key) => (
                <ImageField
                  key={key}
                  compact
                  label={t(`staff.appearance.image.${key}`)}
                  value={draft.extra[key] ?? ''}
                  fallback={DEFAULT_IMAGES[key]}
                  uploading={uploading === `extra:${key}`}
                  onFile={(file) => void onUpload(`extra:${key}`, file)}
                  onRemove={() => {
                    const { [key]: _dropped, ...rest } = draft.extra;
                    setDraft({ ...draft, extra: rest });
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('staff.appearance.destinations')}</span>
            <p className="text-xs text-muted-foreground">
              {t('staff.appearance.destinationsBody')}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {destinationCodes.map((code) => (
                <ImageField
                  key={code}
                  compact
                  label={code}
                  value={draft.destinations[code] ?? ''}
                  fallback={DEFAULT_IMAGES.destinations[code]}
                  uploading={uploading === `dest:${code}`}
                  onFile={(file) => void onUpload(`dest:${code}`, file)}
                  onClear={() =>
                    setDraft({
                      ...draft,
                      destinations: { ...draft.destinations, [code]: '' },
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">{t('staff.appearance.custom')}</span>
            <p className="text-xs text-muted-foreground">{t('staff.appearance.customBody')}</p>
            {Object.keys(draft.extra).length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(draft.extra)
                  .filter(([key]) => !SECTION_KEY_SET.has(key))
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, url]) => (
                    <ImageField
                      key={key}
                      compact
                      label={key}
                      value={url}
                      uploading={uploading === `extra:${key}`}
                      onFile={(file) => void onUpload(`extra:${key}`, file)}
                      onRemove={() => {
                        const { [key]: _dropped, ...rest } = draft.extra;
                        setDraft({ ...draft, extra: rest });
                      }}
                    />
                  ))}
              </div>
            ) : null}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium">
                {t('staff.appearance.key')}
                <Input
                  className="h-8 w-40 text-xs"
                  placeholder="explore"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
              </label>
              <label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs font-medium hover:bg-accent">
                {uploading === `extra:${newKey.trim()}` && uploading !== null
                  ? t('staff.appearance.uploading')
                  : t('staff.appearance.upload')}
                <input
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  className="sr-only"
                  disabled={!KEY_RE.test(newKey.trim()) || uploading !== null}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    const key = newKey.trim();
                    if (file && KEY_RE.test(key)) {
                      void onUpload(`extra:${key}`, file, () => setNewKey(''));
                    }
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="text-xs text-muted-foreground">
                {t('staff.appearance.uploadHint')}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={busy} onClick={() => void onSave()}>
              {busy ? t('staff.appearance.saving') : t('staff.appearance.save')}
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
