import { Injectable } from '@nestjs/common';
import {
  AppError,
  type SiteImagesDto,
  type SiteSettingsDto,
  type SiteTheme,
} from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { maskDeep } from '../../common/logger';
import type { BookingActor } from '../bookings/bookings.service';
import { MethodConfigService } from '../payments/config/method-config.service';

/** Themes the web app ships (must stay in sync with globals.css). */
export const SITE_THEMES: SiteTheme[] = ['sky', 'savanna', 'ocean', 'forest', 'midnight'];

const TOP_LEVEL_IMAGE_KEYS = ['hero', 'auth', 'notFound'] as const;
const DESTINATION_CODE_RE = /^[A-Z0-9]{3}$/;
const MAX_URL_CHARS = 512;
const URL_RE = /^https:\/\/[^\s]+$/;
const TTL_MS = 10_000;

export interface UpdateSiteSettingsInput {
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
  private cache: { at: number; theme: SiteTheme; images: SiteImagesDto } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly methods: MethodConfigService,
  ) {}

  /** Public payload: appearance + the paybill from the active payment plan. */
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

    const current = await this.read();
    const theme = input.theme ?? current.theme;
    const merged = images === undefined ? current.images : images;

    await this.prisma.siteSettings.upsert({
      where: { id: true },
      update: { theme, images: merged as object, updatedById: actor.userId },
      create: { id: true, theme, images: merged as object, updatedById: actor.userId },
    });
    this.cache = null;
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
          metadata: maskDeep({ theme, images: merged }) as object,
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

  private async read(): Promise<{ theme: SiteTheme; images: SiteImagesDto }> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < TTL_MS) {
      return { theme: this.cache.theme, images: this.cache.images };
    }
    const row = await this.prisma.siteSettings.findUnique({ where: { id: true } });
    const theme =
      row && SITE_THEMES.includes(row.theme as SiteTheme) ? (row.theme as SiteTheme) : 'sky';
    const images = sanitizeImages(row?.images);
    this.cache = { at: now, theme, images };
    return { theme, images };
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
      if (!TOP_LEVEL_IMAGE_KEYS.includes(key as (typeof TOP_LEVEL_IMAGE_KEYS)[number])) {
        throw new AppError('VALIDATION_ERROR', `Unknown image key "${key}"`);
      }
      const normalized = this.validateUrl(value, `images.${key}`);
      if (normalized) cleaned[key as 'hero' | 'auth' | 'notFound'] = normalized;
    }
    return cleaned;
  }

  private validateUrl(value: unknown, field: string): string | null {
    if (value === '' || value === null) return null; // clear the override
    if (typeof value !== 'string' || value.length > MAX_URL_CHARS || !URL_RE.test(value)) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${field} must be an https:// URL (max ${MAX_URL_CHARS} chars)`,
      );
    }
    return value;
  }
}

/** Defensive read of the stored JSON — unknown shapes collapse to defaults. */
function sanitizeImages(raw: unknown): SiteImagesDto {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const images: SiteImagesDto = {};
  for (const key of TOP_LEVEL_IMAGE_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && URL_RE.test(value)) images[key] = value;
  }
  const destinations = source.destinations;
  if (typeof destinations === 'object' && destinations !== null && !Array.isArray(destinations)) {
    const map: Record<string, string> = {};
    for (const [code, url] of Object.entries(destinations as Record<string, unknown>)) {
      if (DESTINATION_CODE_RE.test(code) && typeof url === 'string' && URL_RE.test(url)) {
        map[code] = url;
      }
    }
    if (Object.keys(map).length > 0) images.destinations = map;
  }
  return images;
}
