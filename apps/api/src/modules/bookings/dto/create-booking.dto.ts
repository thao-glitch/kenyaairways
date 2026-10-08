import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  DOC_TYPES,
  MAX_PAX_PER_BOOKING,
  PASSENGER_TYPES,
  SUPPORTED_LOCALES,
  type BookingSource,
  type DocType,
  type PassengerType,
  type TripType,
} from '@flight13/shared';

const BOOKING_SOURCES = ['WEB', 'AGENT', 'ADMIN', 'API'] as const;
const TRIP_TYPES = ['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'] as const;

export class SegmentInputDto {
  @ApiProperty({ description: 'Flight instance id from /flights/search' })
  @IsString()
  @MaxLength(40)
  flightId!: string;

  @ApiProperty({ description: 'Fare class code', example: 'SAVER' })
  @Matches(/^[A-Z0-9]{2,12}$/, { message: 'fareClassCode must be a fare class code' })
  fareClassCode!: string;
}

export class PassengerInputDto {
  @ApiProperty({ enum: PASSENGER_TYPES })
  @IsIn(PASSENGER_TYPES as readonly string[])
  type!: PassengerType;

  @ApiProperty({ example: 'Wanjiku' })
  @IsString()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Otieno' })
  @IsString()
  @MaxLength(80)
  lastName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  middleName?: string;

  @ApiPropertyOptional({ description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ description: 'ISO-3166 alpha-2', example: 'KE' })
  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/, { message: 'nationality must be an ISO-3166 alpha-2 code' })
  nationality?: string;

  @ApiPropertyOptional({ enum: DOC_TYPES })
  @IsOptional()
  @IsIn(DOC_TYPES as readonly string[])
  docType?: DocType;

  @ApiPropertyOptional({ description: 'Stored AES-256-GCM encrypted at rest' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  docNumber?: string;

  @ApiPropertyOptional({ description: 'Document expiry, YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  docExpiry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'E.164 Kenyan number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: 'VGML' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  mealPreference?: string;
}

export class SeatRequestDto {
  @ApiProperty({ description: 'Segment index (0-based) the seat belongs to' })
  @IsInt()
  @Min(0)
  segmentSeq!: number;

  @ApiProperty({ description: 'Seat label on the aircraft seat map', example: '12A' })
  @Matches(/^[0-9]{1,2}[A-F]$/, { message: 'seatLabel must look like 12A' })
  seatLabel!: string;
}

export class CreateBookingDto {
  @ApiProperty({ enum: TRIP_TYPES, default: 'ONE_WAY' })
  @IsIn(TRIP_TYPES as readonly string[])
  tripType!: TripType;

  @ApiProperty({ type: [SegmentInputDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @Type(() => SegmentInputDto)
  segments!: SegmentInputDto[];

  @ApiProperty({ type: [PassengerInputDto] })
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAX_PER_BOOKING)
  @Type(() => PassengerInputDto)
  passengers!: PassengerInputDto[];

  @ApiPropertyOptional({ enum: BOOKING_SOURCES, default: 'WEB' })
  @IsOptional()
  @IsIn(BOOKING_SOURCES as readonly string[])
  source?: BookingSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @ApiPropertyOptional({ description: 'E.164 Kenyan number' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contactPhone?: string;

  @ApiPropertyOptional({ description: 'Locale for notifications', enum: SUPPORTED_LOCALES })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as readonly string[])
  locale?: string;

  @ApiPropertyOptional({ type: [SeatRequestDto], description: 'Optional seat holds at booking' })
  @IsOptional()
  @ValidateNested({ each: true })
  @ArrayMaxSize(MAX_PAX_PER_BOOKING)
  @Type(() => SeatRequestDto)
  seats?: SeatRequestDto[];
}

export class HoldSeatDto {
  @ApiProperty({ description: 'Seat label on the aircraft seat map', example: '12A' })
  @Matches(/^[0-9]{1,2}[A-F]$/, { message: 'seatLabel must look like 12A' })
  seatLabel!: string;

  @ApiPropertyOptional({ description: 'Segment index (0-based), defaults to 0' })
  @IsOptional()
  @IsInt()
  @Min(0)
  segmentSeq?: number;
}

export class CancelBookingDto {
  @ApiPropertyOptional({ description: 'Optional reason (recorded in the audit log)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
