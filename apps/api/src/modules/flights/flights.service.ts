import { Injectable } from '@nestjs/common';
import {
  AppError,
  toLocalIso,
  type FareClassDetailDto,
  type FareOptionDto,
  type FlightOptionDto,
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
