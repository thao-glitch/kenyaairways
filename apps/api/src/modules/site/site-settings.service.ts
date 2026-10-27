import { Injectable } from '@nestjs/common';
import {
  AppError,
  normalizeBrandName,
  type SiteImagesDto,
  type SiteSettingsDto,
  type SiteTheme,
} from '@kenyaairways/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { maskDeep } from '../../common/logger';
import type { BookingActor } from '../bookings/bookings.service';
import { MethodConfigService } from '../payments/config/method-config.service';
import { MEDIA_FILE_RE, MEDIA_PATH_PREFIX, MediaService } from './media.service';

/** Themes the web app ships (must stay in sync with globals.css). */
export const SITE_THEMES: SiteTheme[] = [
  'sky',
  'savanna',
  'ocean',
  'forest',
  'midnight',
  'crimson',
];

/** Any flat image key: `hero`, `explore`, `place:nbo`, `holiday-safari`, … */
/** Override keys: leading lowercase letter, then letters/digits/`-`/`:` (camelCase like `notFound` allowed). */
const IMAGE_KEY_RE = /^[a-z][a-zA-Z0-9:-]{0,63}$/;
const DESTINATION_CODE_RE = /^[A-Z0-9]{3}$/;
const MAX_URL_CHARS = 512;
const URL_RE = /^https:\/\/[^\s]+$/;
const TTL_MS = 10_000;
const MAX_NAME_CHARS = 40;

/** Overrides may be an https URL or a path of an upload served by this API. */
function isMediaPath(value: string): boolean {
  return (
    value.startsWith(MEDIA_PATH_PREFIX) && MEDIA_FILE_RE.test(value.slice(MEDIA_PATH_PREFIX.length))
  );
}

export interface UpdateSiteSettingsInput {
  /** Live app name rendered across every surface. */
  appName?: string;
  theme?: SiteTheme;
  images?: SiteImagesDto;
}

/**
 * Site appearance: the active theme and admin-managed image URLs (real
 * photographs, any https origin). Public reads are cached for a few seconds
 * so console edits propagate to every instance without restarts; unset keys
 * fall back to the web app's built-in defaults.
 */
@Injectable()
export class SiteSettingsService {
  private cache: { at: number; appName: string; theme: SiteTheme; images: SiteImagesDto } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly methods: MethodConfigService,
    private readonly media: MediaService,
  ) {}

  /** Public payload: name + appearance + the paybill from the active plan. */
  async get(): Promise<SiteSettingsDto> {
    const [appearance, paybill] = await Promise.all([this.read(), this.paybill()]);
    return { ...appearance, mpesaPaybill: paybill };
  }

  /** Admin update (partial). Empty strings clear an image override. */
  async update(actor: BookingActor, input: UpdateSiteSettingsInput): Promise<SiteSettingsDto> {
    if (input.theme !== undefined && !SITE_THEMES.includes(input.theme)) {
      throw new AppError('VALIDATION_ERROR', `Unknown theme "${input.theme}"`);
    }
    const images = input.images === undefined ? undefined : this.validateImages(input.images);
    const appName = input.appName === undefined ? undefined : this.validateAppName(input.appName);

    const current = await this.read();
    const theme = input.theme ?? current.theme;
    const merged = images === undefined ? current.images : images;
    const name = appName ?? current.appName;

    await this.prisma.siteSettings.upsert({
      where: { id: true },
      update: { theme, appName: name, images: merged as object, updatedById: actor.userId },
      create: {
        id: true,
        theme,
        appName: name,
        images: merged as object,
        updatedById: actor.userId,
      },
    });
    this.cache = null;
    // A replaced or cleared upload is no longer referenced anywhere — drop
    // the file so the media store never accumulates orphans.
    if (images !== undefined) await this.removeOrphanedUploads(current.images, images);
    try {
      await this.prisma.auditLog.create({
        data: {
          action: 'site_settings.update',
          actorId: actor.userId,
          actorRole: actor.role,
          entityType: 'site_settings',
          entityId: 'singleton',
          outcome: 'SUCCESS',
          ip: actor.ip,
          requestId: actor.requestId,
          metadata: maskDeep({ appName: name, theme, images: merged }) as object,
        },
      });
    } catch {
      // audit must never fail the business action
    }
    return this.get();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async paybill(): Promise<string | null> {
    try {
      const method = await this.methods.method('MPESA_STK');
      return method.settings.shortcode || null;
    } catch {
      return null;
    }
  }

  private async read(): Promise<{ appName: string; theme: SiteTheme; images: SiteImagesDto }> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TTL_MS) {
      return { appName: this.cache.appName, theme: this.cache.theme, images: this.cache.images };
    }
    const row = await this.prisma.siteSettings.findUnique({ where: { id: true } });
    const theme =
      row && SITE_THEMES.includes(row.theme as SiteTheme) ? (row.theme as SiteTheme) : 'sky';
    const appName = normalizeBrandName(row?.appName);
    const images = sanitizeImages(row?.images);
    this.cache = { at: now, appName, theme, images };
    return { appName, theme, images };
  }

  /** The live app name: 1-40 printable characters, no control codes. */
  private validateAppName(value: unknown): string {
    if (typeof value !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'appName must be a string');
    }
    const trimmed = value.trim();
    const hasControl = [...trimmed].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127);
    if (!trimmed || trimmed.length > MAX_NAME_CHARS || hasControl) {
      throw new AppError(
        'VALIDATION_ERROR',
        `appName must be 1-${MAX_NAME_CHARS} characters without control codes`,
      );
    }
    return trimmed;
  }

  /** Whitelist + shape-check every image URL; `''` clears an override. */
  private validateImages(input: SiteImagesDto): SiteImagesDto {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new AppError('VALIDATION_ERROR', 'images must be an object');
    }
    const cleaned: SiteImagesDto = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === 'destinations') {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new AppError('VALIDATION_ERROR', 'images.destinations must be an object');
        }
        const destinations: Record<string, string> = {};
        for (const [code, url] of Object.entries(value as Record<string, unknown>)) {
          if (!DESTINATION_CODE_RE.test(code)) {
            throw new AppError('VALIDATION_ERROR', `Invalid airport code "${code}"`);
          }
          const normalized = this.validateUrl(url, `images.destinations.${code}`);
          if (normalized) destinations[code] = normalized;
        }
        if (Object.keys(destinations).length > 0) cleaned.destinations = destinations;
        continue;
      }
      if (!IMAGE_KEY_RE.test(key)) {
        throw new AppError('VALIDATION_ERROR', `Invalid image key "${key}"`);
      }
      const normalized = this.validateUrl(value, `images.${key}`);
      if (normalized) (cleaned as Record<string, string>)[key] = normalized;
    }
    return cleaned;
  }

  private validateUrl(value: unknown, field: string): string | null {
    if (value === '' || value === null) return null; // clear the override
    if (
      typeof value !== 'string' ||
      value.length > MAX_URL_CHARS ||
      (!URL_RE.test(value) && !isMediaPath(value))
    ) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${field} must be an https:// URL or an uploaded media path (max ${MAX_URL_CHARS} chars)`,
      );
    }
    return value;
  }

  /** Best-effort: delete uploads that were referenced before but no longer. */
  private async removeOrphanedUploads(before: SiteImagesDto, after: SiteImagesDto): Promise<void> {
    const was = new Set<string>();
    const is = new Set<string>();
    collectMediaPaths(before, was);
    collectMediaPaths(after, is);
    for (const url of was) {
      if (!is.has(url)) await this.media.removeByUrl(url);
    }
  }
}

/** Every stored upload path inside an images object (flat + destinations). */
function collectMediaPaths(images: SiteImagesDto, into: Set<string>): void {
  for (const [key, value] of Object.entries(images)) {
    if (key === 'destinations') continue;
    if (typeof value === 'string' && isMediaPath(value)) into.add(value);
  }
  const destinations = images.destinations;
  if (destinations) {
    for (const url of Object.values(destinations)) {
      if (isMediaPath(url)) into.add(url);
    }
  }
}

/** Defensive read of the stored JSON — unknown shapes collapse to defaults. */
function sanitizeImages(raw: unknown): SiteImagesDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const images: SiteImagesDto = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'destinations') continue;
    if (
      IMAGE_KEY_RE.test(key) &&
      typeof value === 'string' &&
      (URL_RE.test(value) || isMediaPath(value))
    ) {
      images[key] = value;
    }
  }
  const destinations = source.destinations;
  if (typeof destinations === 'object' && destinations !== null && !Array.isArray(destinations)) {
    const map: Record<string, string> = {};
    for (const [code, url] of Object.entries(destinations as Record<string, unknown>)) {
      if (
        DESTINATION_CODE_RE.test(code) &&
        typeof url === 'string' &&
        (URL_RE.test(url) || isMediaPath(url))
      ) {
        map[code] = url;
      }
    }
    if (Object.keys(map).length > 0) images.destinations = map;
  }
  return images;
}
