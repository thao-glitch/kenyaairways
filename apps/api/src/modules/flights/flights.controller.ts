import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FareClassDetailDto, FareOptionDto, FlightOptionDto } from '@flight13/shared';
import { Public } from '../../common/decorators/public.decorator';
import { FlightsService } from './flights.service';
import { FlightSearchDto } from './dto/flight-search.dto';

@Public()
@Controller('flights')
@ApiTags('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search priced, bookable flights' })
  @ApiOkResponse({ description: 'Flights with fare options and full tax breakdown' })
  search(@Query() query: FlightSearchDto) {
    return this.flights.search(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Flight detail (times, status, aircraft, fares)' })
  @ApiParam({ name: 'id' })
  detail(@Param('id') id: string): Promise<FlightOptionDto> {
    return this.flights.flightDetail(id);
  }

  @Get(':id/fares')
  @ApiOperation({ summary: 'Priced fare options for one flight' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  fares(@Param('id') id: string, @Query('seats') seats?: string): Promise<FareOptionDto[]> {
    const parsed = seats ? Number.parseInt(seats, 10) : 1;
    const seatsNeeded = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 9) : 1;
    return this.flights.flightFares(id, seatsNeeded);
  }
}

@Public()
@Controller('fare-classes')
@ApiTags('flights')
export class FareClassesController {
  constructor(private readonly flights: FlightsService) {}

  @Get()
  @ApiOperation({ summary: 'Active fare classes with their rules' })
  @ApiOkResponse({ type: Object })
  list(): Promise<FareClassDetailDto[]> {
    return this.flights.fareClasses();
  }
}
