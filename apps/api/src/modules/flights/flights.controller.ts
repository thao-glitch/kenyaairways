import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type {
  FareClassDetailDto,
  FareOptionDto,
  FlightOptionDto,
  FlightPositionDto,
  FlightStatusDto,
  SeatMapDto,
} from '@flight13/shared';
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

  @Get(':id/status')
  @ApiOperation({ summary: 'Live flight status + recent status timeline (M6)' })
  @ApiParam({ name: 'id' })
  status(@Param('id') id: string): Promise<FlightStatusDto> {
    return this.flights.flightStatus(id);
  }

  @Get(':id/position')
  @ApiOperation({
    summary:
      'Live aircraft position for the mobile map — interpolated along the great-circle route from real departure/arrival times',
  })
  @ApiParam({ name: 'id' })
  position(@Param('id') id: string): Promise<FlightPositionDto> {
    return this.flights.flightPosition(id);
  }

  @Get(':id/seats')
  @ApiOperation({ summary: 'Seat map with live hold/sold state (M7)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: Object })
  seats(@Param('id') id: string): Promise<SeatMapDto> {
    return this.flights.seatMap(id);
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
