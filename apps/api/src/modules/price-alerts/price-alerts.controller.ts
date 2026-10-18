import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Matches, Min } from 'class-validator';
import type { PriceAlertDto } from '@flight13/shared';
import { CABIN_CLASSES, type CabinClass } from '@flight13/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth-request';
import { PriceAlertsService } from './price-alerts.service';

class CreatePriceAlertDto {
  @ApiProperty({ description: 'Origin IATA code', example: 'NBO' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'originCode must be a 3-letter IATA code' })
  originCode!: string;

  @ApiProperty({ description: 'Destination IATA code', example: 'CDG' })
  @Matches(/^[A-Za-z]{3}$/, { message: 'destinationCode must be a 3-letter IATA code' })
  destinationCode!: string;

  @ApiProperty({ enum: CABIN_CLASSES, default: 'ECONOMY', required: false })
  @IsOptional()
  @IsEnum(CABIN_CLASSES)
  cabin?: CabinClass;

  @ApiProperty({
    description: 'Optional target price in minor units — alert fires when the route hits it',
    example: 8500000,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  targetMinor?: number | null;
}

@ApiTags('price-alerts')
@Controller('price-alerts')
export class PriceAlertsController {
  constructor(private readonly alerts: PriceAlertsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Track the fare on a route (price alert)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePriceAlertDto): Promise<PriceAlertDto> {
    return this.alerts.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My price alerts (active and triggered)' })
  list(@CurrentUser() user: AuthUser): Promise<PriceAlertDto[]> {
    return this.alerts.list(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Stop tracking a route' })
  @ApiParam({ name: 'id' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.alerts.cancel(user.id, id);
  }
}
