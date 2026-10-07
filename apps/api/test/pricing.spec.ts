import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * Tax/fee rules come from the database (per route type). The seeded values are
 * placeholders — these tests assert the *mechanism* (percent vs flat,
 * BASE_FARE vs TOTAL stacking, zero-rated lines dropped), not the rates.
 */
describe('pricing (service)', () => {
  let pricing: PricingService;
  let app: Awaited<ReturnType<typeof createApp>>;

  async function createApp() {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const application = moduleRef.createNestApplication();
    await application.init();
    return application;
  }

  beforeAll(async () => {
    app = await createApp();
    pricing = app.get(PricingService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('stacks percent and flat rules deterministically for DOMESTIC fares', async () => {
    const price = await pricing.price({
      routeType: 'DOMESTIC',
      baseFareMinor: 850_000,
      currency: 'KES',
    });
    expect(price.currency).toBe('KES');
    expect(price.baseFareMinor).toBe(850_000);
    expect(price.taxes.length).toBeGreaterThan(0);
    expect(price.taxesTotalMinor).toBe(
      price.taxes.reduce((sum, line) => sum + line.amountMinor, 0),
    );
    expect(price.totalMinor).toBe(price.baseFareMinor + price.taxesTotalMinor);
    expect(price.totalMinor).toBeGreaterThan(price.baseFareMinor);

    // VAT is BASE_FARE percent; PSC/ASC are flat TOTAL lines.
    const codes = price.taxes.map((t) => t.code);
    expect(codes).toContain('VAT');
    expect(codes).toContain('PSC');
    expect(codes).toContain('ASC');
    const vat = price.taxes.find((t) => t.code === 'VAT')!;
    expect(vat.appliesTo).toBe('BASE_FARE');
    expect(vat.amountMinor).toBe(Math.round(850_000 * 1600) / 10_000);

    // Every amount is an integer minor unit — no fractional KES anywhere.
    for (const line of price.taxes) expect(Number.isInteger(line.amountMinor)).toBe(true);
  });

  it('applies INTERNATIONAL rules for international carriage', async () => {
    const price = await pricing.price({
      routeType: 'INTERNATIONAL',
      baseFareMinor: 4_500_000,
      currency: 'KES',
    });
    expect(price.totalMinor).toBeGreaterThan(4_500_000);
    // International VAT is zero-rated → excluded from the receipt entirely.
    expect(price.taxes.some((t) => t.code === 'VAT')).toBe(false);
    expect(price.taxes.some((t) => t.code === 'FUEL')).toBe(true);
  });

  it('returns base-only pricing when no rules exist for a route type', async () => {
    const price = await pricing.price({
      routeType: 'REGIONAL',
      baseFareMinor: 1_000_000,
      currency: 'KES',
    });
    expect(price.taxes).toEqual([]);
    expect(price.taxesTotalMinor).toBe(0);
    expect(price.totalMinor).toBe(1_000_000);
  });

  it('never produces negative or fractional amounts', async () => {
    const price = await pricing.price({ routeType: 'DOMESTIC', baseFareMinor: 1, currency: 'KES' });
    expect(price.totalMinor).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(price.totalMinor)).toBe(true);
  });
});
