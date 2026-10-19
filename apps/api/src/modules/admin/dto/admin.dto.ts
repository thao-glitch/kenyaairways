import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PAYMENT_PROVIDER_TYPES, type PaymentProviderType } from '@flight13/shared';

/** One fare class row inside a single-flight edit. */
export class FlightPriceFarePatchDto {
  @ApiProperty({ description: 'Fare class code (SAVER, CLASSIC, FLEX)', example: 'SAVER' })
  @IsString()
  @Matches(/^[A-Z0-9]{2,8}$/, { message: 'fareClassCode must be a class code' })
  fareClassCode!: string;

  @ApiProperty({ description: 'New base fare in minor units', example: 9_078_00 })
  @IsInt()
  @Min(1_000)
  @Max(100_000_000)
  baseFareMinor!: number;
}

/** `PATCH /admin/flights/:id/fares` — each class keeps its own price. */
export class FlightPricePatchDto {
  @ApiProperty({ type: [FlightPriceFarePatchDto] })
  @ValidateNested({ each: true })
  @Type(() => FlightPriceFarePatchDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  fares!: FlightPriceFarePatchDto[];
}

/**
 * `POST /admin/flights/bulk-prices` — percent change across a filter.
 * Percent preserves the fare family (saver stays under flex); there is
 * deliberately no bulk SET.
 */
export class BulkPriceUpdateDto {
  @ApiPropertyOptional({ description: 'Origin airport (IATA)', example: 'NBO' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'originCode must be an IATA code' })
  originCode?: string;

  @ApiPropertyOptional({ description: 'Destination airport (IATA)', example: 'CDG' })
  @IsOptional()
  @Matches(/^[A-Z]{3}$/, { message: 'destinationCode must be an IATA code' })
  destinationCode?: string;

  @ApiPropertyOptional({ description: 'First flight date (inclusive)', example: '2026-10-19' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateFrom must be YYYY-MM-DD' })
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Last flight date (inclusive)', example: '2026-11-18' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dateTo must be YYYY-MM-DD' })
  dateTo?: string;

  @ApiProperty({ enum: ['ADJUST_PERCENT'], description: 'Percent change across the filter' })
  @IsIn(['ADJUST_PERCENT'])
  operation!: 'ADJUST_PERCENT';

  @ApiProperty({ description: 'Change in percent, e.g. -10 or 15', example: -10 })
  @IsNumber()
  @Min(-95)
  @Max(500)
  value!: number;
}

/** `POST /admin/bookings/:id/pay` — money taken directly by staff. */
export class RecordPaymentDto {
  @ApiProperty({
    enum: PAYMENT_PROVIDER_TYPES,
    description: 'Usually CASH; any configured provider may be recorded',
    example: 'CASH',
  })
  @IsIn([...PAYMENT_PROVIDER_TYPES])
  provider!: PaymentProviderType;

  @ApiPropertyOptional({ description: 'Defaults to the booking total' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountMinor?: number;

  @ApiPropertyOptional({ description: 'Receipt / drawer reference', example: 'DRAWER-1042' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reference?: string;
}
