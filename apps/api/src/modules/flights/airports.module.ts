import { Controller, Get, Module } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AirportDto } from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('airports')
@ApiTags('flights')
export class AirportsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Airports served (seeded network)' })
  @ApiOkResponse({ description: 'List of airports' })
  async list(): Promise<AirportDto[]> {
    const airports = await this.prisma.airport.findMany({ orderBy: { code: 'asc' } });
    return airports.map((a) => ({
      code: a.code,
      icao: a.icao,
      name: a.name,
      city: a.city,
      country: a.country,
      countryCode: a.countryCode,
      timezone: a.timezone,
      routeType: a.region,
      domestic: a.domestic,
    }));
  }
}

@Module({
  controllers: [AirportsController],
})
export class AirportsModule {}
