import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { BookingDto } from '@kenyaairways/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { actorFromUser, BookingsService } from './bookings.service';
import { CancelBookingDto, CreateBookingDto, HoldSeatDto } from './dto/create-booking.dto';

class ListBookingsDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;
}

@ApiTags('bookings')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a booking (held seats + TTL, pay to confirm)' })
  @ApiOkResponse({ description: 'Created booking with PNR' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBookingDto,
    @Req() req: AuthedRequest,
  ): Promise<BookingDto> {
    const header = req.headers['x-request-id'];
    return this.bookings.create(
      actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined),
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'My bookings (paginated)' })
  list(@CurrentUser() user: AuthUser, @Query() query: ListBookingsDto) {
    return this.bookings.listMine(actorFromUser(user), query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Booking by id (owner or staff)' })
  @ApiParam({ name: 'id' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<BookingDto> {
    return this.bookings.get(id, actorFromUser(user));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a booking and release its inventory' })
  @ApiParam({ name: 'id' })
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: CancelBookingDto,
    @Req() req: AuthedRequest,
  ): Promise<BookingDto> {
    const header = req.headers['x-request-id'];
    return this.bookings.cancel(
      id,
      actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined),
      dto.reason,
    );
  }

  @Post(':id/seats')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hold a specific seat on this booking' })
  @ApiParam({ name: 'id' })
  holdSeat(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: HoldSeatDto,
  ): Promise<BookingDto> {
    return this.bookings.holdSeat(id, actorFromUser(user), dto.seatLabel, dto.segmentSeq ?? 0);
  }

  @Delete(':id/seats/:seatLabel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release a held seat' })
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'seatLabel' })
  releaseSeat(
    @Param('id') id: string,
    @Param('seatLabel') seatLabel: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BookingDto> {
    return this.bookings.releaseSeat(id, actorFromUser(user), seatLabel.toUpperCase());
  }
}
