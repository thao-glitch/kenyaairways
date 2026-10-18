import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type {
  MpesaManualVerificationDto,
  MpesaVerifyCheckDto,
  Paginated,
  PaymentDto,
} from '@flight13/shared';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthedRequest, AuthUser } from '../../../common/auth-request';
import { actorFromUser, type BookingActor } from '../../bookings/bookings.service';
import { MpesaVerifierService } from './mpesa-verifier.service';

const STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED'] as const;

export class PasteMessageDto {
  @ApiProperty({
    description: 'Raw M-Pesa confirmation SMS, pasted verbatim',
    example:
      'SJH4LMOP32 confirmed. Ksh1,500.00 sent to ACCOUNT 0182774255 for account KQ7XYZ123 on 18/10/26 at 3:45 PM.',
  })
  @IsString()
  @MaxLength(4_000)
  message!: string;
}

export class VerifyMessageDto extends PasteMessageDto {
  @ApiPropertyOptional({
    description: 'Booking PNR — defaults to the account reference in the SMS',
  })
  @IsOptional()
  @IsString()
  @MaxLength(12)
  pnr?: string;

  @ApiPropertyOptional({ description: 'Payment id — wins over the PNR when both are given' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentId?: string;

  @ApiPropertyOptional({ description: 'Free-text note stored on the verification record' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class RejectVerificationDto {
  @ApiProperty({ description: 'Why the message cannot confirm the payment' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}

export class ListVerificationsQueryDto {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  page?: string;
}

/**
 * Manual M-Pesa payment records (ADMIN/FINANCE back office). Passengers now
 * settle on their own — pasting the confirmation SMS in the booking flow
 * confirms the payment instantly — so this controller is the audit trail of
 * every verified message plus a manual tool for edge cases (staff can paste
 * an SMS, dry-run it, confirm or correct a record). The receipt number is
 * unique, so one SMS can never confirm two payments.
 */
@ApiBearerAuth()
@ApiTags('admin')
@Controller('admin/mpesa-verifier')
export class MpesaVerifierController {
  constructor(private readonly verifier: MpesaVerifierService) {}

  @Post('parse')
  @HttpCode(200)
  @Roles(Role.FINANCE, Role.ADMIN)
  @ApiOperation({ summary: 'Dry-run: parse a pasted M-Pesa message and report blockers' })
  @ApiOkResponse({ description: 'Parsed fields + issues + the payment it would confirm' })
  async parse(
    @CurrentUser() user: AuthUser,
    @Body() dto: PasteMessageDto,
    @Req() req: AuthedRequest,
  ): Promise<MpesaVerifyCheckDto> {
    return this.verifier.check(this.actor(user, req), { message: dto.message });
  }

  @Post('verify')
  @HttpCode(200)
  @Roles(Role.FINANCE, Role.ADMIN)
  @ApiOperation({ summary: 'Verify a pasted M-Pesa message and mark the payment paid' })
  @ApiOkResponse({ description: 'The verification record and the confirmed payment' })
  async verify(
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyMessageDto,
    @Req() req: AuthedRequest,
  ): Promise<{ record: MpesaManualVerificationDto; payment: PaymentDto }> {
    return this.verifier.verify(this.actor(user, req), dto);
  }

  @Get('records')
  @Roles(Role.FINANCE, Role.ADMIN)
  @ApiOperation({ summary: 'Verification records (passenger submissions + staff verifications)' })
  @ApiQuery({ name: 'status', required: false, enum: STATUSES })
  @ApiQuery({ name: 'page', required: false })
  async records(
    @Query() query: ListVerificationsQueryDto,
  ): Promise<Paginated<MpesaManualVerificationDto>> {
    return this.verifier.list({ status: query.status, page: Number(query.page) || undefined });
  }

  @Post('records/:id/confirm')
  @HttpCode(200)
  @Roles(Role.FINANCE, Role.ADMIN)
  @ApiOperation({ summary: 'Confirm a passenger-submitted message (marks the payment paid)' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'The confirmed record and payment' })
  async confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<{ record: MpesaManualVerificationDto; payment: PaymentDto }> {
    return this.verifier.confirm(this.actor(user, req), id);
  }

  @Post('records/:id/reject')
  @HttpCode(200)
  @Roles(Role.FINANCE, Role.ADMIN)
  @ApiOperation({ summary: 'Reject a passenger-submitted message' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ description: 'The rejected record' })
  async reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectVerificationDto,
    @Req() req: AuthedRequest,
  ): Promise<MpesaManualVerificationDto> {
    return this.verifier.reject(this.actor(user, req), id, dto.reason);
  }

  private actor(user: AuthUser, req: AuthedRequest): BookingActor {
    const header = req.headers['x-request-id'];
    return actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
  }
}
