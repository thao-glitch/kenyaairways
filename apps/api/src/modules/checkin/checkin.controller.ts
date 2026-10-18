import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  AppError,
  MAX_PAX_PER_BOOKING,
  type BaggageDto,
  type BoardingPassDto,
  type CheckInResultDto,
} from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { BaggageService } from './baggage.service';
import { CheckInService } from './checkin.service';

class CheckInRequestDto {
  @ApiProperty({ description: 'Confirmed booking to check passengers in for' })
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @ApiPropertyOptional({
    description: 'Subset of passenger ids (default: everyone)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(MAX_PAX_PER_BOOKING)
  passengerIds?: string[];
}

function actorOf(user: AuthUser, req: AuthedRequest): BookingActor {
  const header = req.headers['x-request-id'];
  return actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
}

@ApiTags('check-in')
@Controller('check-in')
export class CheckInController {
  constructor(
    private readonly checkins: CheckInService,
    private readonly baggage: BaggageService,
  ) {}

  @Get('bookings/:bookingId/baggage')
  @ApiOperation({
    summary:
      'Baggage tracking timeline for a booking — stages derived from real check-in and flight status',
  })
  baggageTimeline(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Param('bookingId') bookingId: string,
  ): Promise<BaggageDto> {
    return this.baggage.forBooking(actorOf(user, req), bookingId);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Check passengers in and issue boarding passes (idempotent)' })
  checkIn(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Body() dto: CheckInRequestDto,
  ): Promise<CheckInResultDto> {
    return this.checkins.checkIn(actorOf(user, req), dto.bookingId, dto.passengerIds);
  }

  @Get()
  @ApiOperation({ summary: 'Check-in status + boarding pass ids for a booking' })
  list(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Query('bookingId') bookingId?: string,
  ): Promise<CheckInResultDto> {
    if (!bookingId) throw new AppError('BAD_REQUEST', 'bookingId query parameter is required');
    return this.checkins.getByBooking(actorOf(user, req), bookingId);
  }
}

@ApiTags('boarding-passes')
@Controller('boarding-passes')
export class BoardingPassController {
  constructor(private readonly checkins: CheckInService) {}

  @Get(':id')
  @ApiOperation({ summary: 'One boarding pass with its IATA BCBP payload' })
  pass(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<BoardingPassDto> {
    return this.checkins.getBoardingPass(actorOf(user, req), id);
  }
}
