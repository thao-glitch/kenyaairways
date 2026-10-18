import { Injectable } from '@nestjs/common';
import {
  AppError,
  toLocalIso,
  type FareClassDetailDto,
  type FareOptionDto,
  type FlightOptionDto,
  type FlightPositionDto,
  type FlightSearchQueryDto,
  type FlightSearchResultDto,
  type FlightStatusDto,
  type SeatMapDto,
  type SeatMapSeatDto,
  type SeatMapStatus,
} from '@flight13/shared';
import type { Flight, Fare } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { PricingService } from '../pricing/pricing.service';
import type { FlightSearchDto } from './dto/flight-search.dto';

/** Search window: flights are loaded ~1 year ahead; seeded data covers 30 days. */
const MAX_LEAD_DAYS = 330;

@Injectable()
export class FlightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  /**
   * `GET /flights/:id/status` — current status plus the recent timeline
   * (M6). Public: departure boards and passenger screens show this without a
   * session; updates to it broadcast `flight.status.changed` over `/rt`.
   */
  async flightStatus(id: string): Promise<FlightStatusDto> {
    const flight = await this.prisma.flight.findUnique({
      where: { id },
      include: { statusEvents: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');
    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      originCode: flight.originCode,
      destinationCode: flight.destinationCode,
      status: flight.status,
      gate: flight.gate,
      delayMinutes: flight.delayMinutes,
      scheduledDepUtc: flight.scheduledDepUtc.toISOString(),
      scheduledArrUtc: flight.scheduledArrUtc.toISOString(),
      actualDepUtc: flight.actualDepUtc?.toISOString() ?? null,
      boardingUtc: flight.boardingUtc?.toISOString() ?? null,
      events: flight.statusEvents.map((ev) => ({
        id: ev.id,
        status: ev.status,
        gate: ev.gate,
        delayMinutes: ev.delayMinutes,
        message: ev.message,
        source: ev.source,
        at: ev.createdAt.toISOString(),
      })),
    };
  }

  /**
   * `GET /flights/:id/position` — live aircraft position for the mobile map
   * (Phase 4). Interpolates along the great-circle route between the two
   * airports using real departure/arrival times. A `PROVIDER` source can be
   * swapped in later (AviationStack / FlightAware adapter) — the shape is
   * identical, so only this method changes.
   */
  async flightPosition(id: string): Promise<FlightPositionDto> {
    const flight = await this.prisma.flight.findUnique({
      where: { id },
      include: { origin: true, destination: true },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');

    const dep = flight.actualDepUtc ?? flight.scheduledDepUtc;
    const arr = flight.scheduledArrUtc;
    const now = Date.now();
    const total = arr.getTime() - dep.getTime();
    const elapsed = now - dep.getTime();
    const rawProgress = total > 0 ? elapsed / total : now >= arr.getTime() ? 1 : 0;
    const progress = Math.min(1, Math.max(0, rawProgress));

    const origin = {
      code: flight.originCode,
      latitude: flight.origin.latitude,
      longitude: flight.origin.longitude,
    };
    const destination = {
      code: flight.destinationCode,
      latitude: flight.destination.latitude,
      longitude: flight.destination.longitude,
    };

    let phase: FlightPositionDto['phase'];
    if (flight.status === 'LANDED' || progress >= 1) phase = 'LANDED';
    else if (
      flight.status === 'BOARDING' ||
      flight.status === 'DEPARTED' ||
      flight.status === 'IN_AIR' ||
      progress > 0
    )
      phase = 'ENROUTE';
    else phase = 'SCHEDULED';

    if (phase === 'SCHEDULED' || phase === 'LANDED') {
      // On the ground: park at the active end of the route.
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
   * `GET /flights/:id/seats` — live seat availability for one flight (M7).
   * A seat's state is derived: blocked on the map, sold (converted hold or
   * issued ticket or check-in assignment), held (active hold), else free.
   */
  async seatMap(flightId: string): Promise<SeatMapDto> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: {
        aircraft: {
          include: { aircraftType: { include: { seatMap: { include: { seats: true } } } } },
        },
        seatHolds: { where: { status: { in: ['ACTIVE', 'CONVERTED'] } } },
        tickets: { where: { status: 'ISSUED' }, select: { seatId: true } },
        checkIns: { where: { seatId: { not: null } }, select: { seatId: true } },
      },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');
    const map = flight.aircraft?.aircraftType.seatMap;
    if (!map) throw new AppError('NOT_FOUND', 'This flight has no seat map');

    const held = new Set(
      flight.seatHolds.filter((h) => h.status === 'ACTIVE').map((h) => h.seatId),
    );
    const sold = new Set<string>();
    for (const h of flight.seatHolds) if (h.status === 'CONVERTED') sold.add(h.seatId);
    for (const t of flight.tickets) if (t.seatId) sold.add(t.seatId);
    for (const c of flight.checkIns) if (c.seatId) sold.add(c.seatId);

    const seats: SeatMapSeatDto[] = map.seats
      .filter((s) => s.active)
      .map((s) => {
        let status: SeatMapStatus = 'AVAILABLE';
        if (s.blocked) status = 'BLOCKED';
        else if (sold.has(s.id)) status = 'OCCUPIED';
        else if (held.has(s.id)) status = 'HELD';
        return {
          id: s.id,
          label: s.label,
          row: s.row,
          letter: s.letter,
          cabin: s.cabin,
          zone: s.zone,
          status,
          extraFeeMinor: s.extraFeeMinor,
          currency: s.currency,
        };
      })
      .sort((a, b) => a.row - b.row || a.letter.localeCompare(b.letter));

    return {
      flightId: flight.id,
      seatMapId: map.id,
      aircraftName: flight.aircraft?.aircraftType.name ?? null,
      seats,
    };
  }

  async search(dto: FlightSearchDto): Promise<FlightSearchResultDto> {
    const originCode = dto.origin.toUpperCase();
    const destinationCode = dto.destination.toUpperCase();
    if (originCode === destinationCode) {
      throw new AppError('BAD_REQUEST', 'Origin and destination must be different');
    }

    const [origin, destination] = await Promise.all([
      this.prisma.airport.findUnique({ where: { code: originCode } }),
      this.prisma.airport.findUnique({ where: { code: destinationCode } }),
    ]);
    if (!origin) throw new AppError('BAD_REQUEST', `Unknown origin airport "${originCode}"`);
    if (!destination)
      throw new AppError('BAD_REQUEST', `Unknown destination airport "${destinationCode}"`);

    const flightDate = this.parseDateOnly(dto.date);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (Number.isNaN(flightDate.getTime())) {
      throw new AppError('BAD_REQUEST', 'date must be a valid calendar date');
    }
    if (flightDate.getTime() < today.getTime()) {
      throw new AppError('BAD_REQUEST', 'date must not be in the past');
    }
    if (flightDate.getTime() > today.getTime() + MAX_LEAD_DAYS * 86_400_000) {
      throw new AppError('BAD_REQUEST', `search window is ${MAX_LEAD_DAYS} days`);
    }

    const seatsNeeded = dto.adults + dto.children; // infants travel on laps
    const flights = await this.prisma.flight.findMany({
      where: {
        originCode,
        destinationCode,
        flightDate,
        status: { not: 'CANCELLED' },
        schedule: { saleStatus: 'OPEN' },
      },
      include: this.include(),
      orderBy: { scheduledDepUtc: 'asc' },
    });

    const results: FlightOptionDto[] = [];
    for (const flight of flights) {
      const option = await this.toOption(flight, seatsNeeded, dto.cabin);
      if (option && option.fareOptions.length > 0) results.push(option);
    }

    const query: FlightSearchQueryDto = {
      origin: originCode,
      destination: destinationCode,
      date: dto.date,
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
      cabin: dto.cabin,
    };
    return { query, results, meta: { count: results.length, currency: 'KES' } };
  }

  async flightDetail(flightId: string): Promise<FlightOptionDto> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: this.include(),
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');
    const option = await this.toOption(flight, 1, undefined);
    if (!option) throw new AppError('NOT_FOUND', 'Flight not found');
    return option;
  }

  /** Priced, availability-checked fare options for a single flight. */
  async flightFares(
    flightId: string,
    seatsNeeded = 1,
    cabin?: FlightSearchDto['cabin'],
  ): Promise<FareOptionDto[]> {
    const flight = await this.prisma.flight.findUnique({
      where: { id: flightId },
      include: this.include(),
    });
    if (!flight) throw new AppError('NOT_FOUND', 'Flight not found');
    const option = await this.toOption(flight, seatsNeeded, cabin);
    return option?.fareOptions ?? [];
  }

  async fareClasses(): Promise<FareClassDetailDto[]> {
    const classes = await this.prisma.fareClass.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      include: { rules: { orderBy: { routeType: 'asc' } } },
    });
    return classes.map((fc) => ({
      code: fc.code,
      name: fc.name,
      cabin: fc.cabin,
      baggageKg: fc.baggageKg,
      carryOnKg: fc.carryOnKg,
      changesAllowed: fc.changesAllowed,
      refundable: fc.refundable,
      sortOrder: fc.sortOrder,
      rules: fc.rules.map((rule) => ({
        routeType: rule.routeType,
        changeAllowed: rule.changeAllowed,
        changeFeeMinor: rule.changeFeeMinor,
        cancelAllowed: rule.cancelAllowed,
        cancelFeePercentBps: rule.cancelFeePercentBps,
        noShowFeeMinor: rule.noShowFeeMinor,
        textEn: rule.textEn,
        textSw: rule.textSw,
        currency: rule.currency as FareClassDetailDto['rules'][number]['currency'],
      })),
    }));
  }

  private include() {
    return {
      origin: true,
      destination: true,
      aircraft: { include: { aircraftType: true } },
      schedule: true,
      fares: {
        where: { saleStatus: 'OPEN', fareClass: { active: true } },
        include: { fareClass: true },
      },
      inventory: true,
    } as const;
  }

  private async toOption(
    flight: FlightWithRefs,
    seatsNeeded: number,
    cabin?: FlightSearchDto['cabin'],
  ): Promise<FlightOptionDto | null> {
    const refs = flight;
    const stockByClass = new Map(refs.inventory.map((i) => [i.fareClassId, i]));
    const fareOptions: FareOptionDto[] = [];

    for (const fare of refs.fares) {
      if (cabin && fare.fareClass.cabin !== cabin) continue;
      const stock = stockByClass.get(fare.fareClassId);
      if (!stock) continue;
      const seatsAvailable =
        stock.seatsTotal - stock.seatsHeld - stock.seatsSold - stock.seatsBlocked;
      if (seatsAvailable < seatsNeeded) continue;
      const pricing = await this.pricing.price({
        routeType: flight.routeType,
        baseFareMinor: fare.baseFareMinor,
        currency: fare.currency,
      });
      fareOptions.push({
        fareClass: {
          code: fare.fareClass.code,
          name: fare.fareClass.name,
          cabin: fare.fareClass.cabin,
          baggageKg: fare.fareClass.baggageKg,
          carryOnKg: fare.fareClass.carryOnKg,
          changesAllowed: fare.fareClass.changesAllowed,
          refundable: fare.fareClass.refundable,
        },
        seatsAvailable,
        pricing,
      });
    }
    fareOptions.sort((a, b) => a.pricing.totalMinor - b.pricing.totalMinor);
    if (fareOptions.length === 0) return null;

    const f = flight;
    return {
      flightId: f.id,
      flightNumber: f.flightNumber,
      routeType: f.routeType,
      origin: airportRef(refs.origin),
      destination: airportRef(refs.destination),
      departUtc: f.scheduledDepUtc.toISOString(),
      arriveUtc: f.scheduledArrUtc.toISOString(),
      departLocal: toLocalIso(f.scheduledDepUtc, refs.origin.timezone),
      arriveLocal: toLocalIso(f.scheduledArrUtc, refs.destination.timezone),
      durationMinutes: Math.round(
        (f.scheduledArrUtc.getTime() - f.scheduledDepUtc.getTime()) / 60_000,
      ),
      boardingLocal: f.boardingUtc ? toLocalIso(f.boardingUtc, refs.origin.timezone) : null,
      status: f.status,
      aircraft: refs.aircraft
        ? { code: refs.aircraft.aircraftType.code, name: refs.aircraft.aircraftType.name }
        : null,
      fareOptions,
    };
  }

  private parseDateOnly(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return new Date(NaN);
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
}

interface FlightWithRefs extends Flight {
  origin: FlightOrigin;
  destination: FlightOrigin;
  aircraft: { registration: string; aircraftType: { code: string; name: string } } | null;
  fares: Array<Fare & { fareClass: FareClassRow }>;
  inventory: Array<{
    fareClassId: string;
    seatsTotal: number;
    seatsHeld: number;
    seatsSold: number;
    seatsBlocked: number;
  }>;
}

interface FlightOrigin {
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
}

interface FareClassRow {
  code: string;
  name: string;
  cabin: FareOptionDto['fareClass']['cabin'];
  baggageKg: number;
  carryOnKg: number;
  changesAllowed: boolean;
  refundable: boolean;
}

function airportRef(a: FlightOrigin) {
  return { code: a.code, name: a.name, city: a.city, country: a.country, timezone: a.timezone };
}

// ── great-circle position math (Phase 4 live tracking) ─────────────────────

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/**
 * Slerp along the great-circle arc between two points at fraction `t`
 * (0 = origin, 1 = destination). Converts to cartesian, blends, converts
 * back — the numerically stable form of the arc interpolation.
 */
function interpolatePoint(
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

/** Great-circle distance in kilometres (haversine). */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δφ = rad(lat2 - lat1);
  const Δλ = rad(lon2 - lon1);
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function centralAngle(φ1: number, λ1: number, φ2: number, λ2: number): number {
  const Δφ = φ2 - φ1;
  const Δλ = λ2 - λ1;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Initial bearing from point A to point B (compass degrees, 0 = north). */
function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = rad(lat1);
  const φ2 = rad(lat2);
  const Δλ = rad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Simple climb/cruise/descent profile: 0 ft on ground, ~35,000 ft at cruise. */
function cruiseAltitudeFt(progress: number): number {
  const climb = 0.12;
  const descent = 0.88;
  if (progress <= climb) return (progress / climb) * 35_000;
  if (progress >= descent) return ((1 - progress) / (1 - descent)) * 35_000;
  return 35_000;
}
