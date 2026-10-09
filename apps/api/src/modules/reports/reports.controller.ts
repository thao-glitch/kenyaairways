import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { LoadReportDto, RevenueReportDto } from '@flight13/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { ReportsService } from './reports.service';

const DAY = { pattern: /^\d{4}-\d{2}-\d{2}$/, message: 'must be YYYY-MM-DD' } as const;

class RevenueQueryDto {
  @ApiPropertyOptional({ ...DAY, description: 'First Nairobi day (inclusive)' })
  @IsOptional()
  @Matches(DAY.pattern, DAY)
  from?: string;

  @ApiPropertyOptional({ ...DAY, description: 'Last Nairobi day (inclusive)' })
  @IsOptional()
  @Matches(DAY.pattern, DAY)
  to?: string;

  @ApiPropertyOptional({ enum: ['KES', 'USD', 'EUR'], default: 'KES' })
  @IsOptional()
  @IsIn(['KES', 'USD', 'EUR'])
  currency?: 'KES' | 'USD' | 'EUR';
}

class LoadQueryDto {
  @ApiPropertyOptional({ ...DAY, description: 'First day (inclusive)' })
  @IsOptional()
  @Matches(DAY.pattern, DAY)
  from?: string;

  @ApiPropertyOptional({ ...DAY, description: 'Last day (inclusive)' })
  @IsOptional()
  @Matches(DAY.pattern, DAY)
  to?: string;

  @ApiPropertyOptional({ description: 'Origin airport code filter (e.g. NBO)' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  origin?: string;
}

@ApiTags('reports')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @Roles('FINANCE', 'ADMIN')
  @ApiOperation({ summary: 'Daily gross/refund/net by Nairobi day (FINANCE)' })
  revenue(@Query() query: RevenueQueryDto): Promise<RevenueReportDto> {
    return this.reports.revenue(query);
  }

  @Get('load')
  @Roles('FINANCE', 'ADMIN', 'OPS')
  @ApiOperation({ summary: 'Capacity vs sold per flight — load factor (FINANCE/OPS)' })
  load(@Query() query: LoadQueryDto): Promise<LoadReportDto> {
    return this.reports.load(query);
  }
}
