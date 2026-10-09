import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import type { PnrLookupDto, TicketIssueResultDto } from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { actorFromUser, BookingsService } from '../bookings/bookings.service';
import { TicketingService } from './ticketing.service';

class IssueTicketDto {
  @ApiProperty({ description: 'Confirmed booking to issue tickets for' })
  @IsString()
  @IsNotEmpty()
  bookingId!: string;
}

@ApiTags('ticketing')
@Controller('ticketing')
export class TicketingController {
  constructor(private readonly ticketing: TicketingService) {}

  @Post('issue')
  @HttpCode(201)
  @ApiOperation({ summary: 'Issue e-tickets for a confirmed booking (idempotent)' })
  issue(
    @CurrentUser() user: AuthUser,
    @Body() dto: IssueTicketDto,
    @Req() req: AuthedRequest,
  ): Promise<TicketIssueResultDto> {
    const header = req.headers['x-request-id'];
    return this.ticketing.issue(
      actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined),
      dto.bookingId,
    );
  }
}

@ApiTags('pnr')
@Controller('pnr')
export class PnrController {
  constructor(private readonly bookings: BookingsService) {}

  @Get(':code')
  @ApiOperation({ summary: 'Retrieve a booking by PNR (owner or staff)' })
  @ApiParam({ name: 'code', description: '6-character PNR', example: 'K3M7PN' })
  lookup(
    @Param('code') code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
  ): Promise<PnrLookupDto> {
    const header = req.headers['x-request-id'];
    return this.bookings.getByPnr(
      actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined),
      code,
    );
  }
}
