import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  CONSENT_PURPOSES,
  SUBJECT_REQUEST_TYPES,
  type ConsentDto,
  type SubjectRequestDto,
  type SubjectRequestResultDto,
} from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { actorFromUser } from '../bookings/bookings.service';
import { PrivacyService } from './privacy.service';

class RecordConsentDto {
  @ApiProperty({ enum: [...CONSENT_PURPOSES], description: 'Purpose the decision covers' })
  @IsIn([...CONSENT_PURPOSES])
  purpose!: (typeof CONSENT_PURPOSES)[number];

  @ApiProperty({ description: 'true records a grant, false records a withdrawal' })
  @IsBoolean()
  granted!: boolean;

  @ApiPropertyOptional({ description: 'Where the decision was made (web|agent|kiosk|app)' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  source?: string;
}

class CreateSubjectRequestDto {
  @ApiProperty({
    enum: [...SUBJECT_REQUEST_TYPES],
    description: 'EXPORT = full copy, DELETE = erasure',
  })
  @IsIn([...SUBJECT_REQUEST_TYPES])
  type!: (typeof SUBJECT_REQUEST_TYPES)[number];

  @ApiPropertyOptional({ description: 'Optional note from the subject' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  notes?: string;
}

/**
 * The signed-in subject's own data rights (Kenya DPA 2019). Every route acts on
 * `req.user` only — there is no way to address another subject, staff or not.
 */
@ApiTags('me')
@Controller('me')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Get('consents')
  @ApiOperation({ summary: 'Consent history — append-only ledger, newest first' })
  async listConsents(@CurrentUser() user: AuthUser): Promise<ConsentDto[]> {
    return this.privacy.listConsents(user.id);
  }

  @Post('consents')
  @ApiOperation({ summary: 'Record a consent grant or withdrawal' })
  async recordConsent(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Body() dto: RecordConsentDto,
  ): Promise<ConsentDto> {
    const actor = actorFromUser(user, req.ip, requestId(req));
    return this.privacy.recordConsent(actor, dto.purpose, dto.granted, dto.source);
  }

  @Get('dsar')
  @ApiOperation({ summary: 'Own data subject request history (export/erasure)' })
  async listRequests(@CurrentUser() user: AuthUser): Promise<SubjectRequestDto[]> {
    return this.privacy.listRequests(user.id);
  }

  @Post('dsar')
  @HttpCode(201)
  @ApiOperation({
    summary: 'File a data subject request — EXPORT returns the copy inline, DELETE erases PII',
  })
  async createRequest(
    @CurrentUser() user: AuthUser,
    @Req() req: AuthedRequest,
    @Body() dto: CreateSubjectRequestDto,
  ): Promise<SubjectRequestResultDto> {
    const actor = actorFromUser(user, req.ip, requestId(req));
    return this.privacy.createRequest(actor, dto.type, dto.notes);
  }
}

function requestId(req: AuthedRequest): string | undefined {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' ? header : undefined;
}
