import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { CABIN_CLASSES, type CabinClass } from '@flight13/shared';

export class FlightSearchDto {
  @ApiProperty({ description: 'Origin IATA code', example: 'NBO' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'origin must be a 3-letter IATA code' })
  origin!: string;

  @ApiProperty({ description: 'Destination IATA code', example: 'MBA' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'destination must be a 3-letter IATA code' })
  destination!: string;

  @ApiProperty({ description: 'Departure date (airport-local), YYYY-MM-DD', example: '2026-10-20' })
  @IsDateString({}, { message: 'date must be an ISO date (YYYY-MM-DD)' })
  date!: string;

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
