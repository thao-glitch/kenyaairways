/**
 * Export the seeded reference data into the JSON the mobile apps embed for
 * OFFLINE mode (both APKs run a local copy of the platform when no backend
 * is reachable).
 *
 * What is exported: airports, aircraft types + seat maps, fare classes
 * (with the seed multipliers, asserted against a real flight), tax rules,
 * flight schedules, users (bcrypt hashes intact), site settings, the payment
 * plan and public meta. Flight *instances* are NOT exported — the apps
 * generate them for a rolling window around "today" so an APK installed
 * months from now still has departures to sell (mirroring
 * seedSchedulesAndFlights).
 *
 * Requires: the dev database (5433) seeded, and the API on :4100 up for
 * /meta + /site-settings. Run from apps/api:
 *
 *   pnpm exec tsx scripts/export-mobile-seed.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const API_BASE = process.env.EXPORT_API_BASE ?? 'http://localhost:4100';
const OUT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/mobile/src/offline/seed/refdata.json',
);

/**
 * Fare multipliers live in prisma/seed.ts's FARE_CLASSES constant — the DB
 * only stores the resulting baseFareMinor, so mirror the values here and
 * ASSERT them against a real seeded flight below.
 */
const FARE_MULTIPLIERS: Record<string, number> = {
  SAVER: 1.0,
  CLASSIC: 1.25,
  FLEX: 1.6,
  BUSINESS: 2.4,
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'X-Client': 'mobile' },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return (await res.json()) as T;
}

async function main() {
  const [
    airports,
    aircraftTypes,
    seatMaps,
    seats,
    fareClasses,
    taxRules,
    schedules,
    users,
    _siteRow,
    planRow,
    methodRows,
  ] = await Promise.all([
    prisma.airport.findMany({ orderBy: [{ code: 'asc' }] }),
    prisma.aircraftType.findMany({ orderBy: [{ code: 'asc' }] }),
    prisma.seatMap.findMany(),
    prisma.seat.findMany({ orderBy: [{ seatMapId: 'asc' }, { row: 'asc' }, { letter: 'asc' }] }),
    prisma.fareClass.findMany({ orderBy: [{ sortOrder: 'asc' }] }),
    prisma.taxFeeRule.findMany({ orderBy: [{ routeType: 'asc' }, { sortOrder: 'asc' }] }),
    prisma.flightSchedule.findMany({ include: { aircraftType: { select: { code: true } } } }),
    // Exactly the six seeded demo accounts — never ship stray test accounts
    // (and their password hashes) inside a public APK.
    prisma.user.findMany({
      where: {
        email: {
          in: [
            'passenger@kenyaairways.example',
            'j.kamau@kenyaairways.example',
            'agent@kenyaairways.example',
            'ops@kenyaairways.example',
            'finance@kenyaairways.example',
            'admin@kenyaairways.example',
          ],
        },
      },
      orderBy: [{ email: 'asc' }],
    }),
    prisma.siteSettings.findUnique({ where: { id: true } }),
    prisma.paymentPlanSettings.findUnique({ where: { id: true } }),
    prisma.paymentMethodConfig.findMany(),
  ]);

  const [meta, site] = await Promise.all([
    fetchJson<unknown>('/api/v1/meta'),
    fetchJson<{ appName: string; theme: string; images: unknown; mpesaPaybill: string | null }>(
      '/api/v1/site-settings',
    ),
  ]);

  const mustHave = ['admin', 'passenger', 'agent', 'ops', 'finance'];
  for (const local of mustHave) {
    if (!users.some((u) => u.email === `${local}@kenyaairways.example`)) {
      throw new Error(`missing seeded user ${local}@kenyaairways.example — run pnpm db:seed`);
    }
  }

  // ── assert the fare multipliers against a real seeded flight ────────────
  const sched = schedules[0];
  if (!sched) throw new Error('no schedules in the database — run pnpm db:seed first');
  const sampleFares = await prisma.fare.findMany({
    where: { flight: { scheduleId: sched.id } },
    include: { fareClass: { select: { code: true } } },
    take: 4,
  });
  for (const fare of sampleFares) {
    const mult = FARE_MULTIPLIERS[fare.fareClass.code];
    if (mult === undefined) throw new Error(`missing multiplier for ${fare.fareClass.code}`);
    const expected = Math.round((sched.baseFareMinor * mult) / 100) * 100;
    if (expected !== fare.baseFareMinor) {
      throw new Error(
        `multiplier mismatch for ${fare.fareClass.code}: computed ${expected} vs db ${fare.baseFareMinor}`,
      );
    }
  }

  // ── payment plan (the offline admin "payment plans" view) ───────────────
  const planMethod = methodRows.find((m) => m.provider === 'MPESA_STK');
  const methods = methodRows.map((row) => ({
    provider: row.provider,
    enabled: row.enabled,
    source: 'DATABASE' as const,
    version: row.version,
    settings: row.settings as Record<string, unknown>,
    secrets: {
      passkey: {
        configured: Boolean((row.secretsEnc as Record<string, unknown> | null)?.passkey),
        masked: null,
      },
    },
    updatedById: row.updatedById,
    updatedAt: row.updatedAt.toISOString(),
  }));
  if (!planMethod) {
    // Fresh DB without the seeded config row → mirror the env defaults.
    methods.unshift({
      provider: 'MPESA_STK' as const,
      enabled: true,
      source: 'ENV' as const,
      version: null,
      settings: { shortcode: process.env.MPESA_SHORTCODE ?? '0182774255' },
      secrets: { passkey: { configured: false, masked: null } },
      updatedById: null,
      updatedAt: null,
    });
  }
  const paymentPlan = {
    defaultProvider: planRow?.defaultProvider ?? process.env.PAYMENT_PROVIDER_DEFAULT ?? 'MOCK',
    encryptionKeyConfigured: Boolean(process.env.ENCRYPTION_KEY),
    methods,
  };

  const refdata = {
    version: 1,
    exportedAt: new Date().toISOString(),
    meta,
    site,
    paymentPlan,
    airports: airports.map((a) => ({
      code: a.code,
      icao: a.icao,
      name: a.name,
      city: a.city,
      country: a.country,
      countryCode: a.countryCode,
      timezone: a.timezone,
      continent: a.continent,
      routeType: a.region,
      domestic: a.domestic,
      latitude: a.latitude,
      longitude: a.longitude,
    })),
    aircraftTypes: aircraftTypes.map((t) => {
      const map = seatMaps.find((m) => m.aircraftTypeId === t.id);
      return {
        code: t.code,
        name: t.name,
        manufacturer: t.manufacturer,
        rangeKm: t.rangeKm,
        cruiseKts: t.cruiseKts,
        co2GramsPerPaxKm: t.co2GramsPerPaxKm,
        seatMapId: map?.id ?? null,
        seatMapName: map?.name ?? null,
        seats: seats
          .filter((s) => s.seatMapId === map?.id)
          .map((s) => ({
            label: s.label,
            row: s.row,
            letter: s.letter,
            cabin: s.cabin,
            zone: s.zone,
            extraFeeMinor: s.extraFeeMinor,
            currency: s.currency,
            blocked: s.blocked,
            active: s.active,
          })),
      };
    }),
    fareClasses: fareClasses.map((fc) => ({
      code: fc.code,
      name: fc.name,
      cabin: fc.cabin,
      baggageKg: fc.baggageKg,
      carryOnKg: fc.carryOnKg,
      changesAllowed: fc.changesAllowed,
      refundable: fc.refundable,
      sortOrder: fc.sortOrder,
      active: fc.active,
      multiplier: FARE_MULTIPLIERS[fc.code] ?? 1,
    })),
    taxRules: taxRules.map((r) => ({
      code: r.code,
      name: r.name,
      routeType: r.routeType,
      calcType: r.calcType,
      percentBps: r.percentBps,
      flatMinor: r.flatMinor,
      appliesTo: r.appliesTo,
      sortOrder: r.sortOrder,
      active: r.active,
      currency: r.currency,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo ? r.effectiveTo.toISOString() : null,
    })),
    schedules: schedules.map((s) => ({
      id: s.id,
      flightNumber: s.flightNumber,
      originCode: s.originCode,
      destinationCode: s.destinationCode,
      aircraftTypeCode: s.aircraftType.code,
      departLocalMinutes: s.departLocalMinutes,
      durationMinutes: s.durationMinutes,
      daysOfWeek: s.daysOfWeek,
      routeType: s.routeType,
      effectiveFrom: s.effectiveFrom.toISOString(),
      effectiveTo: s.effectiveTo ? s.effectiveTo.toISOString() : null,
      baseFareMinor: s.baseFareMinor,
      currency: s.currency,
      saleStatus: s.saleStatus,
    })),
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      status: u.status,
      locale: u.locale,
      timezone: u.timezone,
      passwordHash: u.passwordHash,
      emailVerified: u.emailVerifiedAt !== null,
      phoneVerified: u.phoneVerifiedAt !== null,
      createdAt: u.createdAt.toISOString(),
    })),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(refdata, null, 1)}\n`);
  console.log(
    `✓ ${OUT_PATH}\n` +
      `  airports ${refdata.airports.length} · types ${refdata.aircraftTypes.length} · ` +
      `fareClasses ${refdata.fareClasses.length} · taxRules ${refdata.taxRules.length} · ` +
      `schedules ${refdata.schedules.length} · users ${refdata.users.length}`,
  );
}

main()
  .catch((err) => {
    console.error('export failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
