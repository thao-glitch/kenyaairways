import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CreatePaymentDto {
  @ApiProperty({ description: 'Booking to pay for (must be HELD or PENDING_PAYMENT)' })
  @IsString()
  @MaxLength(40)
  bookingId!: string;

  @ApiPropertyOptional({
    description: 'Phone for M-Pesa STK push (E.164 or 07…/254…; falls back to account phone)',
    example: '+254712345678',
  })
  @IsOptional()
  @Matches(/^\+?\d{9,15}$/, { message: 'msisdn must be a phone number' })
  msisdn?: string;

  @ApiPropertyOptional({
    description: 'Idempotency key — retries with the same key return the same payment',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/, { message: 'idempotencyKey must be URL-safe' })
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description:
      'Manual paybill flow: create the payment WITHOUT pushing anything to the phone. The passenger pays the paybill themselves and pastes the confirmation SMS for staff verification (M-Pesa methods only).',
  })
  @IsOptional()
  @IsBoolean()
  manual?: boolean;
}

export class SimulateStkDto {
  @ApiProperty({
    description:
      'Daraja result code (mock mode only): 0 ok, 1 funds, 1032 cancelled, 1037 timeout, 2001 PIN',
    example: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  resultCode!: number;
}

export class RefundPaymentDto {
  @ApiPropertyOptional({ description: 'Minor units; defaults to the full refundable balance' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountMinor?: number;

  @ApiProperty({ description: 'Why the money is going back (audited)', example: 'Schedule change' })
  @IsString()
  @MaxLength(200)
  reason!: string;

  @ApiProperty({
    description: 'Step-up OTP sent to the FINANCE user phone (purpose REFUND)',
    example: '482913',
  })
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}

export class ListPaymentsQueryDto {
  @ApiProperty({ description: 'Booking id to list payments for' })
  @IsString()
  @MaxLength(40)
  bookingId!: string;
}
