import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { PaymentDto, RefundDto } from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthedRequest, AuthUser } from '../../common/auth-request';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { PaymentsService } from './payments.service';
import {
  CreatePaymentDto,
  ListPaymentsQueryDto,
  RefundPaymentDto,
  SimulateStkDto,
} from './dto/payment.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Start a payment for a booking (idempotent, initiates STK push / intent)',
  })
  @ApiResponse({ status: 201, description: 'Payment created (or replayed by idempotency key)' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentDto,
    @Req() req: AuthedRequest,
  ): Promise<PaymentDto> {
    return this.payments.create(this.actor(user, req), dto);
  }

  @Get()
  @ApiOperation({ summary: 'Payments for a booking (owner or staff)' })
  @ApiQuery({ name: 'bookingId', required: true })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: ListPaymentsQueryDto,
    @Req() req: AuthedRequest,
  ): Promise<PaymentDto[]> {
    return this.payments.listForBooking(this.actor(user, req), query.bookingId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Payment detail (owner or staff)' })
  @ApiParam({ name: 'id' })
  async get(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<PaymentDto> {
    return this.payments.get(this.actor(user, req), id);
  }

  @Post(':id/stk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-initiate the provider attempt for an unpaid payment' })
  async initiate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<PaymentDto> {
    return this.payments.initiateStk(this.actor(user, req), id);
  }

  @Post(':id/simulate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Deliver an STK result (mock mode only) — dev/demo/test helper',
  })
  @ApiResponse({ status: 404, description: 'Not available when MPESA_MODE=live' })
  async simulate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SimulateStkDto,
    @Req() req: AuthedRequest,
  ): Promise<PaymentDto> {
    return this.payments.simulateStk(this.actor(user, req), id, dto.resultCode);
  }

  @Post(':id/refund')
  @HttpCode(201)
  @Roles('FINANCE')
  @ApiOperation({ summary: 'Refund a captured payment (FINANCE role + OTP step-up)' })
  @ApiResponse({ status: 201, description: 'Refund recorded and sent to the provider' })
  async refund(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
    @Req() req: AuthedRequest,
  ): Promise<RefundDto> {
    return this.payments.refund(this.actor(user, req), id, dto);
  }

  private actor(user: AuthUser, req: AuthedRequest): BookingActor {
    const header = req.headers['x-request-id'];
    return actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
  }
}
