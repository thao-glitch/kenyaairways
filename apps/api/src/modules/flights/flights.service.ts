import { Injectable } from '@nestjs/common';
import {
  AppError,
  toLocalIso,
  type FareCalendarDayDto,
  type FareCalendarDto,
  type FareClassDetailDto,
  type FareOptionDto,
  type FleetDto,
  type FlightOptionDto,
  type FlightPositionDto,
  type FlightSearchQueryDto,
  type FlightSearchResultDto,
  type FlightStatusBoardDto,
  type FlightStatusDto,
  type SeatMapDto,
  type SeatMapSeatDto,
  type SeatMapStatus,
  type PriceAdviceDto,
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
    const originCode = dto.origin?.toUpperCase();
    const destinationCode = dto.destination?.toUpperCase();
    if (originCode && destinationCode && originCode === destinationCode) {
      throw new AppError('BAD_REQUEST', 'Origin and destination must be different');
    }

    const [origin, destination] = await Promise.all([
      originCode ? this.prisma.airport.findUnique({ where: { code: originCode } }) : null,
      destinationCode ? this.prisma.airport.findUnique({ where: { code: destinationCode } }) : null,
    ]);
    if (originCode && !origin)
      throw new AppError('BAD_REQUEST', `Unknown origin airport "${originCode}"`);
    if (destinationCode && !destination)
      throw new AppError('BAD_REQUEST', `Unknown destination airport "${destinationCode}"`);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    let flightDate: Date | undefined;
    if (dto.date) {
      flightDate = this.parseDateOnly(dto.date);
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

    const seatsNeeded = dto.adults + dto.children; // infants travel on laps
    const flights = await this.prisma.flight.findMany({
      where: {
        ...(originCode ? { originCode } : {}),
        ...(destinationCode ? { destinationCode } : {}),
        // No date given → search the whole booking window (nearest first).
        flightDate: flightDate ?? { gte: today },
        status: { not: 'CANCELLED' },
        schedule: { saleStatus: 'OPEN' },
      },
      include: this.include(),
      orderBy: { scheduledDepUtc: 'asc' },
      take: dto.limit,
    });

    const results: FlightOptionDto[] = [];
    for (const flight of flights) {
      const option = await this.toOption(flight, seatsNeeded, dto.cabin);
      if (option && option.fareOptions.length > 0) results.push(option);
    }

    const query: FlightSearchQueryDto = {
      origin: originCode ?? '',
      destination: destinationCode ?? '',
      date: dto.date ?? '',
      adults: dto.adults,
      children: dto.children,
      infants: dto.infants,
      cabin: dto.cabin,
    };
    return { query, results, meta: { count: results.length, currency: 'KES' } };
  }

  /**
   * Whole-month fare calendar (Skyscanner style): the cheapest bookable
   * total per calendar day for one city pair, plus the month's best date.
   * Days with no operating flights return `lowestTotalMinor: null`.
   */
  async fareCalendar(
    originCode: string,
    destinationCode: string,
    month: string,
  ): Promise<FareCalendarDto> {
    const origin = originCode.toUpperCase();
    const destination = destinationCode.toUpperCase();
    if (origin === destination) {
      throw new AppError('BAD_REQUEST', 'Origin and destination must be different');
    }
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) throw new AppError('BAD_REQUEST', 'month must be YYYY-MM');
    const year = Number(match[1]);
    const monthIdx = Number(match[2]) - 1;
    if (monthIdx < 0 || monthIdx > 11) throw new AppError('BAD_REQUEST', 'month must be YYYY-MM');

    const [airports] = await Promise.all([
      this.prisma.airport.findMany({ where: { code: { in: [origin, destination] } } }),
    ]);
    if (!airports.some((a) => a.code === origin))
      throw new AppError('BAD_REQUEST', `Unknown origin airport "${origin}"`);
    if (!airports.some((a) => a.code === destination))
      throw new AppError('BAD_REQUEST', `Unknown destination airport "${destination}"`);

    const monthStart = new Date(Date.UTC(year, monthIdx, 1));
    const monthEnd = new Date(Date.UTC(year, monthIdx + 1, 1));
    // Past days are not bookable — never priced, never "best".
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const bookableFrom = monthStart > today ? monthStart : today;
    const flights = await this.prisma.flight.findMany({
      where: {
        originCode: origin,
        destinationCode: destination,
        flightDate: { gte: bookableFrom, lt: monthEnd },
        status: { not: 'CANCELLED' },
        schedule: { saleStatus: 'OPEN' },
      },
      include: this.include(),
      orderBy: { scheduledDepUtc: 'asc' },
    });

    const byDay = new Map<string, FareCalendarDayDto>();
    const daysInMonth = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      byDay.set(date, { date, lowestTotalMinor: null, flightCount: 0 });
    }

    for (const flight of flights) {
      const date = flight.flightDate.toISOString().slice(0, 10);
      const day = byDay.get(date);
      if (!day) continue;
      day.flightCount += 1;
      const option = await this.toOption(flight, 1, 'ECONOMY');
      if (!option) continue;
      for (const fare of option.fareOptions) {
        const total = fare.pricing.totalMinor;
        if (day.lowestTotalMinor === null || total < day.lowestTotalMinor) {
          day.lowestTotalMinor = total;
        }
      }
    }

    const days = [...byDay.values()];
    let bestDate: string | null = null;
    let bestTotal: number | null = null;
    for (const day of days) {
      if (
        day.lowestTotalMinor !== null &&
        (bestTotal === null || day.lowestTotalMinor < bestTotal)
      ) {
        bestTotal = day.lowestTotalMinor;
        bestDate = day.date;
      }
    }

    return { origin, destination, month, currency: 'KES', days, bestDate };
  }

  /**
   * Public status board (Flighty style): look a flight up by number + date
   * without needing the internal id. Returns the next matching departure
   * when no date is given.
   */
  async statusBoard(flightNumber: string, date?: string): Promise<FlightStatusBoardDto> {
    const number = flightNumber.toUpperCase().trim();
    if (!/^[A-Z0-9]{2,6}$/.test(number)) {
      throw new AppError('BAD_REQUEST', 'flightNumber must be 2–6 letters/digits (e.g. F13208)');
    }

    let flightDate: Date | undefined;
    if (date) {
      flightDate = this.parseDateOnly(date);
      if (Number.isNaN(flightDate.getTime())) {
        throw new AppError('BAD_REQUEST', 'date must be a valid calendar date');
      }
    } else {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      flightDate = today;
    }

    const flight = await this.prisma.flight.findFirst({
      where: {
        flightNumber: number,
        ...(date
          ? { flightDate }
          : {
              scheduledDepUtc: {
                gte: new Date(),
                lte: new Date(Date.now() + MAX_LEAD_DAYS * 86_400_000),
              },
            }),
      },
      include: { origin: true, destination: true, aircraft: { include: { aircraftType: true } } },
      orderBy: { scheduledDepUtc: 'asc' },
    });
    if (!flight) throw new AppError('NOT_FOUND', 'No flight found for that number/date');

    const delay = flight.delayMinutes;
    // Actual times win once recorded; otherwise schedule + known delay.
    const estimated = (actual: Date | null, scheduled: Date): Date =>
      actual ?? (delay ? new Date(scheduled.getTime() + delay * 60_000) : scheduled);

    return {
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      date: flight.flightDate.toISOString().slice(0, 10),
      status: flight.status,
      origin: airportRef(flight.origin),
      destination: airportRef(flight.destination),
      scheduledDepLocal: toLocalIso(flight.scheduledDepUtc, flight.origin.timezone),
      scheduledArrLocal: toLocalIso(flight.scheduledArrUtc, flight.destination.timezone),
      estimatedDepLocal: toLocalIso(
        estimated(flight.actualDepUtc, flight.scheduledDepUtc),
        flight.origin.timezone,
      ),
      estimatedArrLocal: toLocalIso(
        estimated(flight.actualArrUtc, flight.scheduledArrUtc),
        flight.destination.timezone,
      ),
      gate: flight.gate,
      terminal: null,
      delayMinutes: delay,
      aircraft: flight.aircraft
        ? { code: flight.aircraft.aircraftType.code, name: flight.aircraft.aircraftType.name }
        : null,
    };
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

  /**
   * `GET /fleet` — every aircraft type with real specifications, its live
   * seat/cabin counts (from the seat map, not hardcoded) and the aircraft
   * registrations flying it. Public: powers the "Our Aircraft" experience
   * page and the footer/mega-menu fleet links.
   */
  async fleet(): Promise<FleetDto> {
    const types = await this.prisma.aircraftType.findMany({
      orderBy: { code: 'asc' },
      include: {
        aircraft: { orderBy: { registration: 'asc' } },
        seatMap: { include: { seats: true } },
      },
    });

    const mapped = types.map((type) => {
      const seats = (type.seatMap?.seats ?? []).filter((seat) => seat.active && !seat.blocked);
      const byCabin = new Map<string, number>();
      for (const seat of seats) byCabin.set(seat.cabin, (byCabin.get(seat.cabin) ?? 0) + 1);
      return {
        code: type.code,
        name: type.name,
        manufacturer: type.manufacturer,
        rangeKm: type.rangeKm,
        cruiseKts: type.cruiseKts,
        co2GramsPerPaxKm: type.co2GramsPerPaxKm,
        seats: seats.length,
        cabins: [...byCabin.entries()].map(([cabin, count]) => ({
          cabin: cabin as FleetDto['types'][number]['cabins'][number]['cabin'],
          count,
        })),
        aircraft: type.aircraft.map((ac) => ({
          registration: ac.registration,
          status: ac.status,
        })),
      };
    });

    return {
      types: mapped,
      totalAircraft: mapped.reduce((sum, type) => sum + type.aircraft.length, 0),
    };
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
      schedule: { include: { aircraftType: true } },
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

    // Google-Flights style CO₂ estimate: great-circle distance × the type's
    // grams-per-pax-km factor (seeded per aircraft type). Business/seats mix
    // is ignored — reported per passenger in grams, rounded to whole kg.
    const distanceKm = haversineKm(
      refs.origin.latitude,
      refs.origin.longitude,
      refs.destination.latitude,
      refs.destination.longitude,
    );
    const gramsPerPaxKm =
      refs.aircraft?.aircraftType.co2GramsPerPaxKm ??
      refs.schedule.aircraftType.co2GramsPerPaxKm ??
      90;
    const co2KgPerPax = Math.max(1, Math.round((distanceKm * gramsPerPaxKm) / 1000));

    // Kayak/Hopper style trend advice: how full the plane is × how soon it
    // leaves. Purely a heuristic over local inventory — no external pricing.
    const seatsTotal = refs.inventory.reduce((sum, i) => sum + i.seatsTotal, 0);
    const seatsCommitted = refs.inventory.reduce((sum, i) => sum + i.seatsSold + i.seatsHeld, 0);
    const daysOut = Math.max(0, (flight.scheduledDepUtc.getTime() - Date.now()) / 86_400_000);
    const priceAdvice = priceAdviceFor(seatsTotal, seatsCommitted, daysOut);

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
      co2KgPerPax,
      ...(priceAdvice ? { priceAdvice } : {}),
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
  schedule: {
    aircraftTypeId: string;
    aircraftType: { code: string; co2GramsPerPaxKm: number | null };
  };
  aircraft: {
    registration: string;
    aircraftType: { code: string; name: string; co2GramsPerPaxKm: number | null };
  } | null;
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
  latitude: number;
  longitude: number;
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

/**
 * Fare-trend heuristic (Kayak/Hopper style) over *local* inventory only —
 * never an external pricing feed, and always shown with a confidence score:
 * - Book now: plane filling fast or departure imminent (prices climb late).
 * - Wait:     seats wide open far from departure (no pressure to buy).
 * - Fair:     everything in between — book whenever it suits you.
 */
function priceAdviceFor(
  seatsTotal: number,
  seatsCommitted: number,
  daysOut: number,
): PriceAdviceDto | undefined {
  if (seatsTotal <= 0) return undefined;
  const fillRatio = seatsCommitted / seatsTotal;

  // Confidence grows with both signals (fullness and imminence).
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
