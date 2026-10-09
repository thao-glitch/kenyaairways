import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  FLIGHT_STATUSES,
  STATUS_SOURCES,
  type FlightStatusDto,
  type ManifestDispatchDto,
  type ManifestDto,
} from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthUser, AuthedRequest } from '../../common/auth-request';
import { actorFromUser, type BookingActor } from '../bookings/bookings.service';
import { OpsService } from './ops.service';

class UpdateFlightStatusDto {
  @ApiPropertyOptional({ enum: [...FLIGHT_STATUSES], description: 'New flight status' })
  @IsOptional()
  @IsIn([...FLIGHT_STATUSES])
  status?: (typeof FLIGHT_STATUSES)[number];

  @ApiPropertyOptional({ description: 'Gate (empty string clears it)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  gate?: string | null;

  @ApiPropertyOptional({ description: 'Delay in minutes', minimum: 0, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  delayMinutes?: number;

  @ApiPropertyOptional({ description: 'Timeline note shown on the public status feed' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  message?: string;

  @ApiPropertyOptional({ enum: [...STATUS_SOURCES], description: 'Who is making the change' })
  @IsOptional()
  @IsIn([...STATUS_SOURCES])
  source?: (typeof STATUS_SOURCES)[number];
}

class ManifestQueryDto {
  @ApiProperty({ description: 'Flight to build the manifest/dispatch list for' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9_-]{10,40}$/, { message: 'flightId must be an id' })
  flightId!: string;
}

@ApiTags('ops')
@Controller('ops')
@Roles('OPS', 'ADMIN')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Patch('flights/:id/status')
  @ApiOperation({ summary: 'Update flight status/gate/delay (OPS) — emits real-time events' })
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFlightStatusDto,
    @Req() req: AuthedRequest,
  ): Promise<FlightStatusDto> {
    return this.ops.updateFlightStatus(this.actor(user, req), id, dto);
  }

  @Get('manifests')
  @ApiOperation({ summary: 'Passenger manifest for one flight (ticketed travellers)' })
  manifest(@Query() query: ManifestQueryDto): Promise<ManifestDto> {
    return this.ops.manifest(query.flightId);
  }

  @Post('manifests/:id/dispatch')
  @HttpCode(201)
  @ApiOperation({ summary: 'Dispatch the manifest via the KCAA hook (async, audited)' })
  dispatch(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() req: AuthedRequest,
  ): Promise<ManifestDispatchDto> {
    return this.ops.requestDispatch(this.actor(user, req), id);
  }

  @Get('dispatches')
  @ApiOperation({ summary: 'Recent manifest dispatch attempts for a flight' })
  dispatches(@Query() query: ManifestQueryDto): Promise<ManifestDispatchDto[]> {
    return this.ops.listDispatches(query.flightId);
  }

  private actor(user: AuthUser, req: AuthedRequest): BookingActor {
    const header = req.headers['x-request-id'];
    return actorFromUser(user, req.ip, typeof header === 'string' ? header : undefined);
  }
}
