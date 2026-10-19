import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  toLocalIso,
  type AdminFlightPriceDto,
  type BulkPriceUpdateResultDto,
} from '@flight13/shared';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { BulkPriceUpdateDto, FlightPricePatchDto } from './dto/admin.dto';

const MAX_LIST = 100;
const FLOOR_MINOR = 1_000; // never price below KES 10

/**
 * Commercial console: see every published fare and move prices — instantly,
 * no reseed. Single-flight edits hit that flight's fares only; bulk updates
 * run across a route/date filter. Pricing reads elsewhere always come from
 * `Fare.baseFareMinor`, so an edit is visible on search results immediately.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/flights')
export class AdminFlightsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Roles(Role.ADMIN, Role.FINANCE, Role.OPS)
  @ApiOperation({ summary: 'List flights with every fare (price manager)' })
  @ApiOkResponse({ description: 'Flights newest-first, capped at 100 rows' })
  async list(
    @Query('origin') origin?: string,
    @Query('destination') destination?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ): Promise<AdminFlightPriceDto[]> {
    const flights = await this.prisma.flight.findMany({
      where: {
        ...(origin ? { originCode: origin.toUpperCase() } : {}),
        ...(destination ? { destinationCode: destination.toUpperCase() } : {}),
        ...(dateFrom || dateTo
          ? {
              flightDate: {
                ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00.000Z`) } : {}),
                ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999Z`) } : {}),
              },
            }
          : {}),
      },
      include: {
        origin: { select: { timezone: true } },
        fares: {
          include: { fareClass: { select: { code: true } } },
          orderBy: { baseFareMinor: 'asc' },
        },
      },
      orderBy: [{ flightDate: 'asc' }, { scheduledDepUtc: 'asc' }],
      take: MAX_LIST,
    });
    return flights.map((f) => ({
      flightId: f.id,
      flightNumber: f.flightNumber,
      flightDate: f.flightDate.toISOString().slice(0, 10),
      originCode: f.originCode,
      destinationCode: f.destinationCode,
      status: f.status,
      departureLocal: toLocalIso(f.scheduledDepUtc, f.origin.timezone),
      fares: f.fares.map((fa) => ({
        fareClassCode: fa.fareClass.code,
        baseFareMinor: fa.baseFareMinor,
        currency: fa.currency as AdminFlightPriceDto['fares'][number]['currency'],
      })),
    }));
  }

  @Patch(':id/fares')
  @Roles(Role.ADMIN, Role.FINANCE)
  @ApiOperation({ summary: 'Edit each fare class price of one flight' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'Counts of the rows that moved' })
  async setFlightPrices(
    @Param('id') id: string,
    @Body() dto: FlightPricePatchDto,
  ): Promise<BulkPriceUpdateResultDto> {
    const flight = await this.prisma.flight.findUnique({ where: { id } });
    if (!flight) {
      return { flightsUpdated: 0, faresUpdated: 0 };
    }
    let faresUpdated = 0;
    for (const fare of dto.fares) {
      const res = await this.prisma.fare.updateMany({
        where: { flightId: id, fareClass: { code: fare.fareClassCode.toUpperCase() } },
        data: { baseFareMinor: fare.baseFareMinor },
      });
      faresUpdated += res.count;
    }
    return { flightsUpdated: faresUpdated > 0 ? 1 : 0, faresUpdated };
  }

  @Post('bulk-prices')
  @Roles(Role.ADMIN, Role.FINANCE)
  @ApiOperation({ summary: 'Set or adjust fares across a route/date filter' })
  @ApiOkResponse({ description: 'Counts of flights and fare rows updated' })
  async bulk(@Body() dto: BulkPriceUpdateDto): Promise<BulkPriceUpdateResultDto> {
    const where = {
      ...(dto.originCode ? { originCode: dto.originCode } : {}),
      ...(dto.destinationCode ? { destinationCode: dto.destinationCode } : {}),
      ...(dto.dateFrom || dto.dateTo
        ? {
            flightDate: {
              ...(dto.dateFrom ? { gte: new Date(`${dto.dateFrom}T00:00:00.000Z`) } : {}),
              ...(dto.dateTo ? { lte: new Date(`${dto.dateTo}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    };
    const flights = await this.prisma.flight.findMany({ where, select: { id: true } });
    const flightIds = flights.map((f) => f.id);
    if (flightIds.length === 0) return { flightsUpdated: 0, faresUpdated: 0 };

    // ADJUST_PERCENT — read, nudge, write (fare families keep their spread).
    const fares = await this.prisma.fare.findMany({
      where: { flightId: { in: flightIds } },
      select: { id: true, baseFareMinor: true },
    });
    let changed = 0;
    for (const fare of fares) {
      const next = Math.max(FLOOR_MINOR, Math.round(fare.baseFareMinor * (1 + dto.value / 100)));
      if (next === fare.baseFareMinor) continue;
      await this.prisma.fare.update({ where: { id: fare.id }, data: { baseFareMinor: next } });
      changed += 1;
    }
    return { flightsUpdated: flights.length, faresUpdated: changed };
  }
}
