import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SUPPORTED_LOCALES } from '@flight13/shared';

const passwordRules = {
  message: 'password must be 10–128 characters and contain at least one letter and one digit',
} as const;

export class RegisterDto {
  @ApiPropertyOptional({ example: 'jane@flight13.example' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'E.164 Kenyan number, e.g. +254712345678' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10, passwordRules)
  @MaxLength(128, passwordRules)
  @Matches(/[A-Za-z]/, passwordRules)
  @Matches(/\d/, passwordRules)
  password!: string;

  @ApiProperty({ example: 'Jane' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  firstName!: string;

  @ApiProperty({ example: 'Wanjiku' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  lastName!: string;

  @ApiPropertyOptional({ enum: SUPPORTED_LOCALES, default: 'en-KE' })
  @IsOptional()
  @IsIn(SUPPORTED_LOCALES as readonly string[])
  locale?: string;

  @ApiProperty({ description: 'Accepts terms + privacy notice (Kenya DPA 2019)' })
  @IsBoolean()
  acceptTerms!: boolean;
}

export class LoginDto {
  @ApiProperty({ description: 'Email address or E.164 phone number' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password!: string;
}

export class OtpRequestDto {
  @ApiProperty({ description: 'E.164 phone number or email address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  destination!: string;

  @ApiProperty({ enum: ['LOGIN', 'VERIFY_PHONE', 'RESET_PASSWORD', 'CHANGE_PHONE', 'REFUND'] })
  @IsIn(['LOGIN', 'VERIFY_PHONE', 'RESET_PASSWORD', 'CHANGE_PHONE', 'REFUND'])
  purpose!: 'LOGIN' | 'VERIFY_PHONE' | 'RESET_PASSWORD' | 'CHANGE_PHONE' | 'REFUND';
}

export class OtpVerifyDto {
  @ApiProperty({ description: 'E.164 phone number or email address' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  destination!: string;

  @ApiProperty({ description: '6-digit code', example: '482913' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be exactly 6 digits' })
  code!: string;

  @ApiProperty({ enum: ['LOGIN', 'VERIFY_PHONE', 'RESET_PASSWORD', 'CHANGE_PHONE', 'REFUND'] })
  @IsIn(['LOGIN', 'VERIFY_PHONE', 'RESET_PASSWORD', 'CHANGE_PHONE', 'REFUND'])
  purpose!: 'LOGIN' | 'VERIFY_PHONE' | 'RESET_PASSWORD' | 'CHANGE_PHONE' | 'REFUND';
}
