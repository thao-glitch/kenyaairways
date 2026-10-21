/**
 * Tax/fee engine — a faithful port of the API's PricingService
 * (apps/api/src/modules/pricing/pricing.service.ts).
 *
 * `appliesTo: BASE_FARE` is evaluated against the base fare; `TOTAL` against
 * the running total, in sortOrder — stacking is deterministic. Zero-rated
 * lines (e.g. international VAT) stay out of the receipt, exactly like the
 * server.
 */
import type { PricingDto, PricingLineDto } from '@kenyaairways/shared';

export interface TaxRuleRow {
  code: string;
  name: string;
  routeType: string;
  calcType: 'PERCENT' | 'FLAT';
  percentBps: number | null;
  flatMinor: number | null;
  appliesTo: string;
  sortOrder: number;
  active: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export function activeTaxRules(
  rules: TaxRuleRow[],
  routeType: string,
  currency: string,
  todayIso: string,
): TaxRuleRow[] {
  return rules
    .filter(
      (r) =>
        r.active === 1 &&
        r.routeType === routeType &&
        r.currency === currency &&
        r.effectiveFrom <= todayIso &&
        (r.effectiveTo === null || r.effectiveTo >= todayIso),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function priceFare(
  rules: TaxRuleRow[],
  input: { routeType: string; baseFareMinor: number; currency: string; todayIso: string },
): PricingDto {
  const applicable = activeTaxRules(rules, input.routeType, input.currency, input.todayIso);
  const base = Math.max(0, Math.round(input.baseFareMinor));

  const taxes: PricingLineDto[] = [];
  let running = base;
  for (const rule of applicable) {
    const anchor = rule.appliesTo === 'TOTAL' ? running : base;
    const raw =
      rule.calcType === 'PERCENT'
        ? Math.round((anchor * (rule.percentBps ?? 0)) / 10_000)
        : (rule.flatMinor ?? 0);
    if (raw === 0) continue;
    taxes.push({
      code: rule.code,
      name: rule.name,
      calcType: rule.calcType,
      appliesTo: rule.appliesTo as 'BASE_FARE' | 'TOTAL',
      amountMinor: raw,
    });
    running += raw;
  }

  return {
    currency: (input.currency as PricingDto['currency']) ?? 'KES',
    baseFareMinor: base,
    taxes,
    taxesTotalMinor: running - base,
    totalMinor: running,
  };
}
