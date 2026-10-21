/**
 * Flight search / detail / status / position / seat map — port of
 * apps/api/src/modules/flights/flights.service.ts against SQLite.
 *
 * Same validation, same toOption filtering (availability gate + fare-family
 * sort), same CO2 + price-advice heuristics; flight instances come from
 * world.ensureWindow / world.ensureRoute ("fly anywhere, any day").
 */
import {
  AppError,
  toLocalIso,
  type FareOptionDto,
  type FlightOptionDto,
  type FlightPositionDto,
  type FlightSearchResultDto,
  type FlightStatusDto,
  type PriceAdviceDto,
  type SeatMapDto,
  type SeatMapSeatDto,
} from '@kenyaairways/shared';
import {
  deriveStatus,
  intParam,
  loadFlight,
  type EngineCtx,
  type FlightRow,
} from './engine-support';
import { priceFare } from './pricing';
import { bearing, cruiseAltitudeFt, dateStr, haversineKm, interpolatePoint } from './world';

const MAX_LEAD_DAYS = 330;
const DEFAULT_LIMIT = 100;

export interface SearchQuery {
  origin?: string;
  destination?: string;
  date?: string;
  adults?: string;
  children?: string;
  infants?: string;
  cabin?: string;
  limit?: string;
}

export function searchFlights(ctx: EngineCtx, q: SearchQuery): FlightSearchResultDto {
  const originCode = q.origin?.toUpperCase() || undefined;
  const destinationCode = q.destination?.toUpperCase() || undefined;
  if (originCode && destinationCode && originCode === destinationCode) {
    throw new AppError('BAD_REQUEST', 'Origin and destination must be different');
  }
  if (originCode && !ctx.world.airports.has(originCode)) {
    throw new AppError('BAD_REQUEST', `Unknown origin airport "${originCode}"`);
  }
  if (destinationCode && !ctx.world.airports.has(destinationCode)) {
    throw new AppError('BAD_REQUEST', `Unknown destination airport "${destinationCode}"`);
  }

  const today = new Date(ctx.now());
  today.setUTCHours(0, 0, 0, 0);
  let flightDate: Date | undefined;
  if (q.date) {
    flightDate = parseDateOnly(q.date);
    if (Number.isNaN(flightDate.getTime())) {
      throw new AppError('BAD_REQUEST', 'date must be a valid calendar date');
    }
    if (flightDate.getTime() < today.getTime()) {
      throw new AppError('BAD_REQUEST', 'date must not be in the past');
    }
    if (flightDate.getTime() > today.getTime() + MAX_LEAD_DAYS * 86_400_000) {
      throw new AppError('BAD_REQUEST', `search window is ${MAX_LEAD_DAYS} days`);
    }
  }

  const adults = intParam(q.adults, 1, 1, 9);
  const children = intParam(q.children, 0, 0, 8);
  const infants = intParam(q.infants, 0, 0, 4);
  const limit = intParam(q.limit, DEFAULT_LIMIT, 1, 200);
  const cabin = (q.cabin as FareOptionDto['fareClass']['cabin'] | undefined) ?? 'ECONOMY';
  const seatsNeeded = adults + children; // infants travel on laps

  // "Fly anywhere, any day": materialise the pair before searching.
  if (originCode && destinationCode) {
    if (flightDate) {
      ctx.world.ensureRoute(originCode, destinationCode, flightDate);
    } else {
      for (let i = 0; i < 14; i += 1) {
        ctx.world.ensureRoute(
          originCode,
          destinationCode,
          new Date(today.getTime() + i * 86_400_000),
        );
      }
    }
  }

  const rows = ctx.db.all<FlightRow>(
    `SELECT * FROM flights
      WHERE (? IS NULL OR originCode = ?)
        AND (? IS NULL OR destinationCode = ?)
        AND (? IS NULL OR flightDate = ?)
        AND (? IS NOT NULL OR flightDate >= ?)
        AND status <> 'CANCELLED'
        AND saleStatus = 'OPEN'
      ORDER BY depUtc
      LIMIT ?`,
    [
      originCode ?? null,
      originCode ?? null,
      destinationCode ?? null,
      destinationCode ?? null,
      flightDate ? dateStr(flightDate) : null,
      flightDate ? dateStr(flightDate) : null,
      flightDate ? dateStr(flightDate) : null,
      dateStr(today),
      limit,
    ],
  );

  const results: FlightOptionDto[] = [];
  for (const row of rows) {
    const option = toOption(ctx, row, seatsNeeded, cabin);
    if (option && option.fareOptions.length > 0) results.push(option);
  }

  return {
    query: {
      origin: originCode ?? '',
      destination: destinationCode ?? '',
      date: q.date ?? '',
      adults,
      children,
      infants,
      cabin,
    },
    results,
    meta: { count: results.length, currency: 'KES' },
  };
}

export function flightDetail(ctx: EngineCtx, id: string): FlightOptionDto {
  const row = loadFlight(ctx, id);
  const option = toOption(ctx, row, 1, undefined);
  if (!option) throw new AppError('NOT_FOUND', 'Flight not found');
  return option;
}

export function flightStatus(ctx: EngineCtx, id: string): FlightStatusDto {
  const row = loadFlight(ctx, id);
  const status = deriveStatus(row, ctx.now()) as FlightStatusDto['status'];
  return {
    flightId: row.id,
    flightNumber: row.flightNumber,
    originCode: row.originCode,
    destinationCode: row.destinationCode,
    status,
    gate: row.gate,
    delayMinutes: row.delayMinutes,
    scheduledDepUtc: row.depUtc,
    scheduledArrUtc: row.arrUtc,
    // No pushback feed offline — the scheduled instant stands in once airborne.
    actualDepUtc:
      status === 'DEPARTED' || status === 'IN_AIR' || status === 'LANDED' ? row.depUtc : null,
    boardingUtc: row.boardingUtc,
    events: [],
  };
}

export function flightPosition(ctx: EngineCtx, id: string): FlightPositionDto {
  const flight = loadFlight(ctx, id);
  const originAirport = ctx.world.airports.get(flight.originCode);
  const destAirport = ctx.world.airports.get(flight.destinationCode);
  if (!originAirport || !destAirport) throw new AppError('NOT_FOUND', 'Flight not found');

  const dep = Date.parse(flight.depUtc);
  const arr = Date.parse(flight.arrUtc);
  const now = ctx.now();
  const total = arr - dep;
  const elapsed = now - dep;
  const rawProgress = total > 0 ? elapsed / total : now >= arr ? 1 : 0;
  const progress = Math.min(1, Math.max(0, rawProgress));

  const origin = {
    code: flight.originCode,
    latitude: originAirport.latitude,
    longitude: originAirport.longitude,
  };
  const destination = {
    code: flight.destinationCode,
    latitude: destAirport.latitude,
    longitude: destAirport.longitude,
  };

  const status = deriveStatus(flight, now);
  let phase: FlightPositionDto['phase'];
  if (status === 'LANDED' || progress >= 1) phase = 'LANDED';
  else if (status === 'BOARDING' || status === 'DEPARTED' || status === 'IN_AIR' || progress > 0)
    phase = 'ENROUTE';
  else phase = 'SCHEDULED';

  if (phase === 'SCHEDULED' || phase === 'LANDED') {
    const point = phase === 'SCHEDULED' ? origin : destination;
    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      origin,
      destination,
      position: { latitude: point.latitude, longitude: point.longitude },
      phase,
      progress,
      headingDeg: bearing(
        origin.latitude,
        origin.longitude,
        destination.latitude,
        destination.longitude,
      ),
      altitudeFt: 0,
      groundSpeedKts: 0,
      source: 'SCHEDULE',
      updatedAt: new Date(now).toISOString(),
    };
  }

  const point = interpolatePoint(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude,
    progress,
  );
  const legKm = haversineKm(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude,
  );
  const blockHours = Math.max(total, 1) / 3_600_000;
  return {
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    origin,
    destination,
    position: { latitude: point.latitude, longitude: point.longitude },
    phase,
    progress,
    headingDeg: bearing(
      point.latitude,
      point.longitude,
      destination.latitude,
      destination.longitude,
    ),
    altitudeFt: Math.round(cruiseAltitudeFt(progress)),
    groundSpeedKts: Math.round(legKm / 1.852 / blockHours),
    source: 'SCHEDULE',
    updatedAt: new Date(now).toISOString(),
  };
}

/**
 * `GET /flights/:id/seats` — seat states derived from the seat template plus
 * live holds/tickets/check-ins on this flight.
 */
export function seatMap(ctx: EngineCtx, flightId: string): SeatMapDto {
  const flight = loadFlight(ctx, flightId);
  const type = ctx.world.aircraftTypes.get(flight.aircraftTypeCode);
  if (!type) throw new AppError('NOT_FOUND', 'This flight has no seat map');
  const nowIso = new Date(ctx.now()).toISOString();

  const held = new Set(
    ctx.db
      .all<{ seatLabel: string }>(
        `SELECT seatLabel FROM seat_holds
          WHERE flightId = ? AND status = 'ACTIVE' AND expiresAt > ?`,
        [flightId, nowIso],
      )
      .map((r) => r.seatLabel),
  );
  const sold = new Set<string>();
  for (const r of ctx.db.all<{ seatLabel: string }>(
    `SELECT seatLabel FROM seat_holds WHERE flightId = ? AND status = 'CONVERTED'`,
    [flightId],
  )) {
    if (r.seatLabel) sold.add(r.seatLabel);
  }
  for (const r of ctx.db.all<{ seatLabel: string | null }>(
    `SELECT seatLabel FROM tickets WHERE flightId = ? AND status = 'ISSUED'`,
    [flightId],
  )) {
    if (r.seatLabel) sold.add(r.seatLabel);
  }
  for (const r of ctx.db.all<{ seatLabel: string | null }>(
    'SELECT seatLabel FROM checkins WHERE flightId = ? AND seatLabel IS NOT NULL',
    [flightId],
  )) {
    if (r.seatLabel) sold.add(r.seatLabel);
  }

  const seats: SeatMapSeatDto[] = type.seats
    .filter((s) => s.active)
    .map((s) => {
      let status: SeatMapSeatDto['status'] = 'AVAILABLE';
      if (s.blocked) status = 'BLOCKED';
      else if (sold.has(s.label)) status = 'OCCUPIED';
      else if (held.has(s.label)) status = 'HELD';
      return {
        id: `${type.seatMapId}:${s.label}`,
        label: s.label,
        row: s.row,
        letter: s.letter,
        cabin: s.cabin as SeatMapSeatDto['cabin'],
        zone: s.zone as SeatMapSeatDto['zone'],
        status,
        extraFeeMinor: s.extraFeeMinor,
        currency: s.currency,
      };
    })
    .sort((a, b) => a.row - b.row || a.letter.localeCompare(b.letter));

  return { flightId, seatMapId: type.seatMapId, aircraftName: type.name, seats };
}

// ── toOption (fare options + pricing + advice) ──────────────────────────────

interface FareRow {
  fareClassCode: string;
  baseFareMinor: number;
  saleStatus: string;
}

interface InventoryRow {
  fareClassCode: string;
  seatsTotal: number;
  seatsHeld: number;
  seatsSold: number;
  seatsBlocked: number;
}

export function toOption(
  ctx: EngineCtx,
  flight: FlightRow,
  seatsNeeded: number,
  cabin?: FareOptionDto['fareClass']['cabin'],
): FlightOptionDto | null {
  const origin = ctx.world.airports.get(flight.originCode);
  const destination = ctx.world.airports.get(flight.destinationCode);
  if (!origin || !destination) return null;

  const fares = ctx.db.all<FareRow>(
    `SELECT f.* FROM fares f
       JOIN fare_classes fc ON fc.code = f.fareClassCode
      WHERE f.flightId = ? AND f.saleStatus = 'OPEN' AND fc.active = 1`,
    [flight.id],
  );
  const stock = ctx.db.all<InventoryRow>('SELECT * FROM inventory WHERE flightId = ?', [flight.id]);
  const stockByClass = new Map(stock.map((i) => [i.fareClassCode, i]));

  const fareOptions: FareOptionDto[] = [];
  for (const fare of fares) {
    const fc = ctx.world.fareClasses.find((f) => f.code === fare.fareClassCode);
    if (!fc) continue;
    if (cabin && fc.cabin !== cabin) continue;
    const inv = stockByClass.get(fare.fareClassCode);
    if (!inv) continue;
    const seatsAvailable = inv.seatsTotal - inv.seatsHeld - inv.seatsSold - inv.seatsBlocked;
    if (seatsAvailable < seatsNeeded) continue;
    const pricing = priceFare(ctx.world.taxRules, {
      routeType: flight.routeType,
      baseFareMinor: fare.baseFareMinor,
      currency: flight.currency,
      todayIso: flight.flightDate,
    });
    fareOptions.push({
      fareClass: {
        code: fc.code,
        name: fc.name,
        cabin: fc.cabin as FareOptionDto['fareClass']['cabin'],
        baggageKg: fc.baggageKg,
        carryOnKg: fc.carryOnKg,
        changesAllowed: fc.changesAllowed,
        refundable: fc.refundable,
      },
      seatsAvailable,
      pricing,
    });
  }
  fareOptions.sort((a, b) => a.pricing.totalMinor - b.pricing.totalMinor);
  if (fareOptions.length === 0) return null;

  const type = ctx.world.aircraftTypes.get(flight.aircraftTypeCode);
  const distanceKm = haversineKm(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude,
  );
  const gramsPerPaxKm = type?.co2GramsPerPaxKm ?? 90;
  const co2KgPerPax = Math.max(1, Math.round((distanceKm * gramsPerPaxKm) / 1000));

  const seatsTotal = stock.reduce((sum, i) => sum + i.seatsTotal, 0);
  const seatsCommitted = stock.reduce((sum, i) => sum + i.seatsSold + i.seatsHeld, 0);
  const daysOut = Math.max(0, (Date.parse(flight.depUtc) - ctx.now()) / 86_400_000);
  const advice = priceAdviceFor(seatsTotal, seatsCommitted, daysOut);

  return {
    flightId: flight.id,
    flightNumber: flight.flightNumber,
    routeType: flight.routeType as FlightOptionDto['routeType'],
    origin: {
      code: origin.code,
      name: origin.name,
      city: origin.city,
      country: origin.country,
      timezone: origin.timezone,
    },
    destination: {
      code: destination.code,
      name: destination.name,
      city: destination.city,
      country: destination.country,
      timezone: destination.timezone,
    },
    departUtc: flight.depUtc,
    arriveUtc: flight.arrUtc,
    departLocal: toLocalIso(flight.depUtc, origin.timezone),
    arriveLocal: toLocalIso(flight.arrUtc, destination.timezone),
    durationMinutes: Math.round((Date.parse(flight.arrUtc) - Date.parse(flight.depUtc)) / 60_000),
    boardingLocal: flight.boardingUtc ? toLocalIso(flight.boardingUtc, origin.timezone) : null,
    status: deriveStatus(flight, ctx.now()) as FlightOptionDto['status'],
    aircraft: type ? { code: type.code, name: type.name } : null,
    fareOptions,
    co2KgPerPax,
    ...(advice ? { priceAdvice: advice } : {}),
  };
}

/** Kayak/Hopper style trend advice over local inventory (verbatim port). */
export function priceAdviceFor(
  seatsTotal: number,
  seatsCommitted: number,
  daysOut: number,
): PriceAdviceDto | undefined {
  if (seatsTotal <= 0) return undefined;
  const fillRatio = seatsCommitted / seatsTotal;

  const fullnessScore = Math.min(1, Math.max(0, (fillRatio - 0.3) / 0.5));
  const urgencyScore = daysOut <= 3 ? 1 : daysOut >= 21 ? 0 : (21 - daysOut) / 18;

  if (fillRatio >= 0.65 || (daysOut <= 7 && fillRatio >= 0.45)) {
    const confidencePct = Math.min(95, Math.round(55 + 40 * ((fullnessScore + urgencyScore) / 2)));
    return { verdict: 'BOOK_NOW', confidencePct };
  }
  if (daysOut >= 21 && fillRatio < 0.35) {
    const confidencePct = Math.min(
      90,
      Math.round(50 + 40 * (1 - fullnessScore) * (1 - urgencyScore)),
    );
    return { verdict: 'WAIT', confidencePct };
  }
  return { verdict: 'FAIR', confidencePct: 60 };
}

export function parseDateOnly(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(NaN);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}
