import { Injectable } from '@nestjs/common';
import type { PricingDto, PricingLineDto } from '@kenyaairways/shared';
import type { RouteType, TaxFeeRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { createLogger } from '../../common/logger';

const CACHE_TTL_MS = 30_000;

export interface PriceInput {
  routeType: RouteType;
  baseFareMinor: number;
  currency: string;
}

/**
 * Applies the configurable TaxFeeRule rows to a base fare.
 *
 * Rules are loaded per route type and cached for 30s (they change rarely, but
 * search is hot). `appliesTo: BASE_FARE` is evaluated against the base fare;
 * `appliesTo: TOTAL` is evaluated against the running total, in sortOrder —
 * so stacking is deterministic and reproducible by finance.
 *
 * NOTE: seeded rates are placeholders — finance must confirm before go-live.
 */
@Injectable()
export class PricingService {
  private readonly log = createLogger('pricing');
  private cache = new Map<string, { rows: TaxFeeRule[]; loadedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  private async rules(routeType: RouteType, currency: string): Promise<TaxFeeRule[]> {
    const key = `${routeType}:${currency}`;
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.loadedAt < CACHE_TTL_MS) return hit.rows;

    const rows = await this.load(routeType, currency);
    this.cache.set(key, { rows, loadedAt: now });
    return rows;
  }

  private async load(routeType: RouteType, currency: string) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    return this.prisma.taxFeeRule.findMany({
      where: {
        active: true,
        routeType,
        currency,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async price(input: PriceInput): Promise<PricingDto> {
    const rules = await this.rules(input.routeType, input.currency);
    const base = Math.max(0, Math.round(input.baseFareMinor));

    const taxes: PricingLineDto[] = [];
    let running = base;
    for (const rule of rules) {
      const isPercent = rule.calcType === 'PERCENT';
      const anchor = rule.appliesTo === 'TOTAL' ? running : base;
      const raw = isPercent
        ? Math.round((anchor * (rule.percentBps ?? 0)) / 10_000)
        : (rule.flatMinor ?? 0);
      if (raw === 0) continue; // zero-rated lines (e.g. international VAT) stay out of the receipt
      taxes.push({
        code: rule.code,
        name: rule.name,
        calcType: rule.calcType as 'PERCENT' | 'FLAT',
        appliesTo: rule.appliesTo as 'BASE_FARE' | 'TOTAL',
        amountMinor: raw,
      });
      running += raw;
    }

    if (rules.length === 0) {
      this.log.debug('no tax rules for route type', { routeType: input.routeType });
    }

    return {
      currency: (input.currency as PricingDto['currency']) ?? 'KES',
      baseFareMinor: base,
      taxes,
      taxesTotalMinor: running - base,
      totalMinor: running,
    };
  }

  /** Test helper — drops the in-memory rule cache. */
  clearCache(): void {
    this.cache.clear();
  }
}
