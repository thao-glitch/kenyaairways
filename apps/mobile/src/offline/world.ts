/**
 * The offline world: reference data + generated flight instances.
 *
 * `World.load()` seeds static data (airports, aircraft types with their seat
 * templates, fare classes, tax rules, schedules, the six seeded users and the
 * live site settings) from `seed/refdata.json` — exported from the dev
 * database by `apps/api/scripts/export-mobile-seed.ts` — then generates
 * flight instances for a rolling window, mirroring how the API seeds and how
 * `FlightsService.createRouteService` materialises "fly anywhere, any day"
 * routes.
 *
 * Generation is idempotent (`INSERT OR IGNORE` on the schedule+date key), so
 * the window can be extended lazily as the traveller searches further out.
 */
import refdata from './seed/refdata.json';
import type { SqlDb } from './db';
import { multiInsert, execMulti, sqlParams } from './db';
import { ensureSchema, kvGet, kvSet } from './schema';
import type { TaxRuleRow } from './pricing';

export interface SeatTemplate {
  label: string;
  row: number;
  letter: string;
  cabin: string;
  zone: string;
  extraFeeMinor: number;
  currency: string;
  blocked: boolean;
  active: boolean;
}

export interface AircraftTypeRow {
  code: string;
  name: string;
  manufacturer: string;
  rangeKm: number | null;
  cruiseKts: number | null;
  co2GramsPerPaxKm: number | null;
  seatMapId: string;
  seatMapName: string;
  seats: SeatTemplate[];
}

export interface FareClassRow {
  code: string;
  name: string;
  cabin: string;
  baggageKg: number;
  carryOnKg: number;
  changesAllowed: boolean;
  refundable: boolean;
  sortOrder: number;
  active: boolean;
  multiplier: number;
}

export interface ScheduleRow {
  id: string;
  flightNumber: string;
  originCode: string;
  destinationCode: string;
  aircraftTypeCode: string;
  departLocalMinutes: number;
  durationMinutes: number;
  daysOfWeek: number[];
  routeType: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  baseFareMinor: number;
  currency: string;
  saleStatus: string;
}

export interface AirportRow {
  code: string;
  icao: string | null;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  timezone: string;
  continent: string;
  routeType: string;
  domestic: boolean;
  latitude: number;
  longitude: number;
}

export interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  locale: string;
  timezone: string | null;
  emailVerified: number;
  phoneVerified: number;
  createdAt: string;
}

interface RefData {
  version: string;
  meta: unknown;
  site: { appName: string; theme: string; images: Record<string, unknown>; mpesaPaybill: string };
  airports: AirportRow[];
  aircraftTypes: Array<Omit<AircraftTypeRow, 'seats'> & { seats: SeatTemplate[] }>;
  fareClasses: FareClassRow[];
  taxRules: TaxRuleRow[];
  schedules: ScheduleRow[];
  users: Array<{
    id: string;
    email: string | null;
    phone: string | null;
    passwordHash: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    locale: string;
    timezone: string | null;
    emailVerified: boolean;
    phoneVerified: boolean;
    createdAt: string;
  }>;
}

const data = refdata as unknown as RefData;

/** Economy seat split across the three economy fare classes (server seed). */
const SAVER_SHARE = 0.45;
const CLASSIC_SHARE = 0.35;

const MAX_PARAMS_PER_STATEMENT = 900;

function chunk<T>(rows: T[], maxRows: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += maxRows) out.push(rows.slice(i, i + maxRows));
  return out;
}

// ── wall-clock → UTC (schedule materialisation) ─────────────────────────────

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Great-circle distance in kilometres (haversine) — port of flights.service. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δφ = rad(lat2 - lat1);
  const Δλ = rad(lon2 - lon1);
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Initial bearing from A to B (compass degrees). */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Slerp along the great-circle arc at fraction t (0 = origin, 1 = dest). */
export function interpolatePoint(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number,
): { latitude: number; longitude: number } {
  const φ1 = rad(lat1);
  const λ1 = rad(lon1);
  const φ2 = rad(lat2);
  const λ2 = rad(lon2);
  const d = centralAngle(φ1, λ1, φ2, λ2);
  if (d === 0) return { latitude: lat1, longitude: lon1 };
  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);
  const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
  const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
  const z = a * Math.sin(φ1) + b * Math.sin(φ2);
  return {
    latitude: deg(Math.atan2(z, Math.sqrt(x * x + y * y))),
    longitude: deg(Math.atan2(y, x)),
  };
}

/** Climb/cruise/descent altitude profile: 0 ft on ground, ~35,000 at cruise. */
export function cruiseAltitudeFt(progress: number): number {
  const climb = 0.12;
  const descent = 0.88;
  if (progress <= climb) return (progress / climb) * 35_000;
  if (progress >= descent) return ((1 - progress) / (1 - descent)) * 35_000;
  return 35_000;
}

function centralAngle(φ1: number, λ1: number, φ2: number, λ2: number): number {
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function tzOffsetMs(ts: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(ts))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - ts;
}

/** Local wall-clock time in an IANA zone → absolute UTC instant. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  minutesFromMidnight: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesFromMidnight * 60_000;
  const firstPass = guess - tzOffsetMs(guess, timeZone);
  return new Date(guess - tzOffsetMs(firstPass, timeZone));
}

// ── world ───────────────────────────────────────────────────────────────────

export class World {
  readonly meta = data.meta;
  readonly paymentPlan = (data as unknown as { paymentPlan: unknown }).paymentPlan;
  readonly airports = new Map<string, AirportRow>();
  readonly aircraftTypes = new Map<string, AircraftTypeRow>();
  readonly fareClasses: FareClassRow[] = [];
  readonly taxRules: TaxRuleRow[] = [];
  readonly carrier: string;

  private constructor(readonly db: SqlDb) {
    this.carrier = (data.meta as { airline: { iataCode: string } }).airline.iataCode;
  }

  /** Opens/creates the offline DB, seeds refdata and generates flights. */
  static load(db: SqlDb, opts: { windowDaysAhead?: number } = {}): World {
    ensureSchema(db);
    const world = new World(db);
    world.seedRefData();
    world.seedUsers();
    world.seedSiteSettings();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    world.ensureWindow(today, addDays(today, opts.windowDaysAhead ?? 30));
    return world;
  }

  // ── seeding ───────────────────────────────────────────────────────────────

  private seedRefData(): void {
    if (kvGet(this.db, 'refdata_version') === data.version) {
      // Cached: hydrate in-memory maps without re-inserting.
      this.hydrateMaps();
      return;
    }

    this.db.transaction(() => {
      this.db.run('DELETE FROM airports');
      this.db.run('DELETE FROM aircraft_types');
      this.db.run('DELETE FROM fare_classes');
      this.db.run('DELETE FROM tax_rules');
      this.db.run('DELETE FROM schedules');

      execMulti(
        this.db,
        multiInsert(
          'airports',
          [
            'code',
            'icao',
            'name',
            'city',
            'country',
            'countryCode',
            'timezone',
            'continent',
            'routeType',
            'domestic',
            'latitude',
            'longitude',
          ],
          data.airports.map((a) => [
            a.code,
            a.icao,
            a.name,
            a.city,
            a.country,
            a.countryCode,
            a.timezone,
            a.continent,
            a.routeType,
            a.domestic,
            a.latitude,
            a.longitude,
          ]),
        ),
      );

      for (const t of data.aircraftTypes) {
        this.db.run(
          `INSERT OR REPLACE INTO aircraft_types
             (code, name, manufacturer, rangeKm, cruiseKts, co2GramsPerPaxKm, seatMapId, seatMapName, seatsJson)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            t.code,
            t.name,
            t.manufacturer,
            t.rangeKm,
            t.cruiseKts,
            t.co2GramsPerPaxKm,
            t.seatMapId,
            t.seatMapName,
            JSON.stringify(t.seats),
          ],
        );
      }

      execMulti(
        this.db,
        multiInsert(
          'fare_classes',
          [
            'code',
            'name',
            'cabin',
            'baggageKg',
            'carryOnKg',
            'changesAllowed',
            'refundable',
            'sortOrder',
            'active',
            'multiplier',
          ],
          data.fareClasses.map((f) => [
            f.code,
            f.name,
            f.cabin,
            f.baggageKg,
            f.carryOnKg,
            f.changesAllowed,
            f.refundable,
            f.sortOrder,
            f.active,
            f.multiplier,
          ]),
        ),
      );

      execMulti(
        this.db,
        multiInsert(
          'tax_rules',
          [
            'code',
            'routeType',
            'currency',
            'name',
            'calcType',
            'percentBps',
            'flatMinor',
            'appliesTo',
            'sortOrder',
            'active',
            'effectiveFrom',
            'effectiveTo',
          ],
          data.taxRules.map((r) => [
            r.code,
            r.routeType,
            r.currency,
            r.name,
            r.calcType,
            r.percentBps,
            r.flatMinor,
            r.appliesTo,
            r.sortOrder,
            r.active,
            r.effectiveFrom,
            r.effectiveTo,
          ]),
        ),
      );

      execMulti(
        this.db,
        multiInsert(
          'schedules',
          [
            'id',
            'flightNumber',
            'originCode',
            'destinationCode',
            'aircraftTypeCode',
            'departLocalMinutes',
            'durationMinutes',
            'daysOfWeekJson',
            'routeType',
            'effectiveFrom',
            'effectiveTo',
            'baseFareMinor',
            'currency',
            'saleStatus',
          ],
          data.schedules.map((s) => [
            s.id,
            s.flightNumber,
            s.originCode,
            s.destinationCode,
            s.aircraftTypeCode,
            s.departLocalMinutes,
            s.durationMinutes,
            JSON.stringify(s.daysOfWeek),
            s.routeType,
            s.effectiveFrom,
            s.effectiveTo,
            s.baseFareMinor,
            s.currency,
            s.saleStatus,
          ]),
        ),
      );

      kvSet(this.db, 'refdata_version', data.version);
    });
    this.hydrateMaps();
  }

  private hydrateMaps(): void {
    this.airports.clear();
    this.aircraftTypes.clear();
    this.fareClasses.length = 0;
    this.taxRules.length = 0;

    for (const a of this.db.all<Record<string, unknown>>('SELECT * FROM airports')) {
      const row = a as unknown as Omit<AirportRow, 'domestic'> & { domestic: number };
      this.airports.set(row.code, { ...row, domestic: row.domestic === 1 });
    }
    for (const t of this.db.all<{ seatsJson: string }>('SELECT * FROM aircraft_types')) {
      const row = t as unknown as AircraftTypeRow & { seatsJson: string };
      this.aircraftTypes.set(row.code, {
        ...row,
        seats: JSON.parse(row.seatsJson) as SeatTemplate[],
      });
    }
    for (const f of this.db.all<Record<string, unknown>>(
      'SELECT * FROM fare_classes ORDER BY sortOrder',
    )) {
      const row = f as unknown as Omit<FareClassRow, 'changesAllowed' | 'refundable' | 'active'> & {
        changesAllowed: number;
        refundable: number;
        active: number;
      };
      this.fareClasses.push({
        ...row,
        changesAllowed: row.changesAllowed === 1,
        refundable: row.refundable === 1,
        active: row.active === 1,
      });
    }
    for (const r of this.db.all<TaxRuleRow>('SELECT * FROM tax_rules')) {
      this.taxRules.push(r);
    }
  }

  private seedUsers(): void {
    if (kvGet(this.db, 'users_version') === data.version) return;
    this.db.transaction(() => {
      this.db.run('DELETE FROM users');
      execMulti(
        this.db,
        multiInsert(
          'users',
          [
            'id',
            'email',
            'phone',
            'passwordHash',
            'firstName',
            'lastName',
            'role',
            'status',
            'locale',
            'timezone',
            'emailVerified',
            'phoneVerified',
            'createdAt',
          ],
          data.users.map((u) => [
            u.id,
            u.email,
            u.phone,
            u.passwordHash,
            u.firstName,
            u.lastName,
            u.role,
            u.status,
            u.locale,
            u.timezone,
            u.emailVerified,
            u.phoneVerified,
            u.createdAt,
          ]),
        ),
      );
      kvSet(this.db, 'users_version', data.version);
    });
  }

  private seedSiteSettings(): void {
    this.db.run(
      `INSERT INTO site_settings (id, app_name, theme, images_json, mpesa_paybill, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      sqlParams([
        data.site.appName,
        data.site.theme,
        JSON.stringify(data.site.images),
        data.site.mpesaPaybill,
        new Date().toISOString(),
      ]),
    );
  }

  // ── flight generation ─────────────────────────────────────────────────────

  /**
   * Generates instances of every schedule that operates in [from, to] and is
   * not already in the DB. Idempotent and cheap on re-run (one SELECT of the
   * window, then only missing pairs are inserted).
   */
  ensureWindow(from: Date, to: Date): void {
    const fromStr = dateStr(from);
    const toStr = dateStr(to);
    const existing = new Set(
      this.db
        .all<{ scheduleId: string; flightDate: string }>(
          'SELECT scheduleId, flightDate FROM flights WHERE flightDate >= ? AND flightDate <= ?',
          [fromStr, toStr],
        )
        .map((r) => `${r.scheduleId}|${r.flightDate}`),
    );

    const flightRows: Array<Array<string | number | null>> = [];
    const fareRows: Array<Array<string | number | null>> = [];
    const invRows: Array<Array<string | number | null>> = [];

    for (const sched of this.allSchedules()) {
      if (sched.saleStatus !== 'OPEN') continue;
      for (let day = new Date(from); day <= to; day = addDays(day, 1)) {
        const dStr = dateStr(day);
        if (sched.effectiveFrom && dStr < sched.effectiveFrom.slice(0, 10)) continue;
        if (sched.effectiveTo && dStr > sched.effectiveTo.slice(0, 10)) continue;
        if (!sched.daysOfWeek.includes(day.getUTCDay())) continue;
        if (existing.has(`${sched.id}|${dStr}`)) continue;
        this.pushGenerated(sched, dStr, flightRows, fareRows, invRows);
      }
    }

    this.flushGenerated(flightRows, fareRows, invRows);
  }

  /**
   * "Fly anywhere, any day" — port of FlightsService.createRouteService.
   * Materialises an F9xxxx schedule + the flight for `date` when a city pair
   * has no published service. Deterministic per pair.
   */
  ensureRoute(originCode: string, destinationCode: string, date: Date): void {
    const origin = this.airports.get(originCode);
    const destination = this.airports.get(destinationCode);
    if (!origin || !destination) return;

    const km = haversineKm(
      origin.latitude,
      origin.longitude,
      destination.latitude,
      destination.longitude,
    );
    const typeCode = km <= 1600 ? 'E190' : km <= 5400 ? 'B738' : 'B789';

    // Deterministic number in the F9xxxx block (published timetable uses
    // F13xxx); verify the slot belongs to this pair before reusing it.
    const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 99_991, 7);
    const base = 90_000 + ((hash(originCode) * 13 + hash(destinationCode)) % 9_000);
    let flightNumber = `F${base}`;
    let scheduleId = `sched_${flightNumber}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = this.db.get<{ originCode: string; destinationCode: string }>(
        'SELECT originCode, destinationCode FROM schedules WHERE id = ?',
        [scheduleId],
      );
      if (
        !existing ||
        (existing.originCode === originCode && existing.destinationCode === destinationCode)
      )
        break;
      flightNumber = `F${base + attempt + 1}`;
      scheduleId = `sched_${flightNumber}`;
    }

    if (!this.aircraftTypes.has(typeCode)) return;

    const cruiseKmh = (typeCode === 'B789' ? 490 : typeCode === 'B738' ? 450 : 430) * 1.852;
    const durationMin = Math.round((km / cruiseKmh) * 60) + (km > 6000 ? 60 : 45);
    const departLocalMinutes =
      7 * 60 + ((hash(originCode) * 7 + hash(destinationCode) * 11) % (13 * 60));
    // ≈ KES 14/km long-haul economics, KES 22/km with a floor for short hops.
    const baseFareMinor =
      km <= 1600
        ? Math.max(Math.round((km * 2200) / 50_000) * 50_000, 650_000)
        : Math.round((km * 1400) / 50_000) * 50_000;
    const routeType = origin.domestic && destination.domestic ? 'DOMESTIC' : 'INTERNATIONAL';

    this.db.transaction(() => {
      this.db.run(
        `INSERT OR IGNORE INTO schedules
           (id, flightNumber, originCode, destinationCode, aircraftTypeCode, departLocalMinutes,
            durationMinutes, daysOfWeekJson, routeType, effectiveFrom, effectiveTo, baseFareMinor, currency, saleStatus)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        sqlParams([
          scheduleId,
          flightNumber,
          originCode,
          destinationCode,
          typeCode,
          departLocalMinutes,
          durationMin,
          JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
          routeType,
          new Date(Date.now() - 7 * 86_400_000).toISOString(),
          null,
          baseFareMinor,
          'KES',
          'OPEN',
        ]),
      );

      const flightRows: Array<Array<string | number | null>> = [];
      const fareRows: Array<Array<string | number | null>> = [];
      const invRows: Array<Array<string | number | null>> = [];
      const sched: ScheduleRow = {
        id: scheduleId,
        flightNumber,
        originCode,
        destinationCode,
        aircraftTypeCode: typeCode,
        departLocalMinutes,
        durationMinutes: durationMin,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        routeType,
        effectiveFrom: null,
        effectiveTo: null,
        baseFareMinor,
        currency: 'KES',
        saleStatus: 'OPEN',
      };
      this.pushGenerated(sched, dateStr(date), flightRows, fareRows, invRows);
      this.flushGenerated(flightRows, fareRows, invRows);
    });
  }

  /** Number of flights already generated for a city pair on a date. */
  countFlights(originCode: string, destinationCode: string, date: string): number {
    return (
      this.db.get<{ n: number }>(
        'SELECT COUNT(*) AS n FROM flights WHERE originCode = ? AND destinationCode = ? AND flightDate = ?',
        [originCode, destinationCode, date],
      )?.n ?? 0
    );
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private allSchedules(): ScheduleRow[] {
    return this.db
      .all<Omit<ScheduleRow, 'daysOfWeek'> & { daysOfWeekJson: string }>(
        'SELECT * FROM schedules ORDER BY id',
      )
      .map((s) => ({ ...s, daysOfWeek: JSON.parse(s.daysOfWeekJson) as number[] }));
  }

  private pushGenerated(
    sched: ScheduleRow,
    dStr: string,
    flightRows: Array<Array<string | number | null>>,
    fareRows: Array<Array<string | number | null>>,
    invRows: Array<Array<string | number | null>>,
  ): void {
    const origin = this.airports.get(sched.originCode);
    const type = this.aircraftTypes.get(sched.aircraftTypeCode);
    if (!origin || !type) return;

    const [y, m, d] = dStr.split('-').map(Number);
    const dep = zonedToUtc(y, m, d, sched.departLocalMinutes, origin.timezone);
    const arr = new Date(dep.getTime() + sched.durationMinutes * 60_000);
    const boarding = new Date(dep.getTime() - 45 * 60_000);
    const flightId = `${sched.id}|${dStr}`;

    flightRows.push([
      flightId,
      sched.id,
      sched.flightNumber,
      sched.originCode,
      sched.destinationCode,
      sched.routeType,
      sched.aircraftTypeCode,
      dStr,
      dep.toISOString(),
      arr.toISOString(),
      boarding.toISOString(),
      'SCHEDULED',
      null,
      0,
      sched.currency,
      sched.saleStatus,
    ]);

    const seats = type.seats.filter((s) => s.active);
    const economy = seats.filter((s) => s.cabin === 'ECONOMY').length;
    const business = seats.filter((s) => s.cabin === 'BUSINESS').length;
    const saver = Math.floor(economy * SAVER_SHARE);
    const classic = Math.floor(economy * CLASSIC_SHARE);
    const flex = economy - saver - classic;

    for (const fc of this.fareClasses) {
      if (!fc.active) continue;
      if (fc.cabin === 'BUSINESS' ? business === 0 : economy === 0) continue;
      const fareBase = Math.round((sched.baseFareMinor * (fc.multiplier ?? 1)) / 100) * 100;
      const seatsTotal =
        fc.cabin === 'BUSINESS'
          ? business
          : fc.code === 'SAVER'
            ? saver
            : fc.code === 'CLASSIC'
              ? classic
              : flex;
      fareRows.push([flightId, fc.code, fareBase, 'OPEN']);
      invRows.push([flightId, fc.code, seatsTotal, 0, 0, 0]);
    }
  }

  private flushGenerated(
    flightRows: Array<Array<string | number | null>>,
    fareRows: Array<Array<string | number | null>>,
    invRows: Array<Array<string | number | null>>,
  ): void {
    if (flightRows.length === 0) return;
    this.db.transaction(() => {
      for (const part of chunk(flightRows, Math.floor(MAX_PARAMS_PER_STATEMENT / 16))) {
        execMulti(
          this.db,
          multiInsert(
            'flights',
            [
              'id',
              'scheduleId',
              'flightNumber',
              'originCode',
              'destinationCode',
              'routeType',
              'aircraftTypeCode',
              'flightDate',
              'depUtc',
              'arrUtc',
              'boardingUtc',
              'status',
              'gate',
              'delayMinutes',
              'currency',
              'saleStatus',
            ],
            part,
          ),
        );
      }
      for (const part of chunk(fareRows, Math.floor(MAX_PARAMS_PER_STATEMENT / 4))) {
        execMulti(
          this.db,
          multiInsert('fares', ['flightId', 'fareClassCode', 'baseFareMinor', 'saleStatus'], part),
        );
      }
      for (const part of chunk(invRows, Math.floor(MAX_PARAMS_PER_STATEMENT / 6))) {
        execMulti(
          this.db,
          multiInsert(
            'inventory',
            ['flightId', 'fareClassCode', 'seatsTotal', 'seatsHeld', 'seatsSold', 'seatsBlocked'],
            part,
          ),
        );
      }
    });
  }
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function dateStr(date: Date): string {
  return date.toISOString().slice(0, 10);
}
