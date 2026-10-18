import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CABIN_CLASSES, type CabinClass } from '@flight13/shared';

/** Empty query params (`?origin=`) mean "no filter", not a validation error. */
const emptyToUndefined = ({ value }: { value: unknown }): unknown =>
  value === '' ? undefined : value;

export class FlightSearchDto {
  @ApiPropertyOptional({
    description: 'Origin IATA code (omit to search every origin)',
    example: 'NBO',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'origin must be a 3-letter IATA code' })
  origin?: string;

  @ApiPropertyOptional({
    description: 'Destination IATA code (omit to search every destination)',
    example: 'MBA',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'destination must be a 3-letter IATA code' })
  destination?: string;

  @ApiPropertyOptional({
    description: 'Departure date (airport-local), YYYY-MM-DD — omit to search the whole window',
    example: '2026-10-20',
  })
  @Transform(emptyToUndefined)
  @IsOptional()
  @IsDateString({}, { message: 'date must be an ISO date (YYYY-MM-DD)' })
  date?: string;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 100;

  @ApiProperty({ default: 1, minimum: 1, maximum: 9 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9)
  adults: number = 1;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8)
  children: number = 0;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    maximum: 4,
    description: 'Infants under 2 (on lap)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CABIN_CLASSES, default: 'ECONOMY' })
  @IsOptional()
  @IsEnum(CABIN_CLASSES as unknown as Record<string, string>)
  cabin: CabinClass = 'ECONOMY';
}
