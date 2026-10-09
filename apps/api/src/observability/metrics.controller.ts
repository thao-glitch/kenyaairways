import { Controller, Get, Header } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

/** Prometheus scrape endpoint (root-level, like the health probes). */
@Public()
@ApiTags('observability')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics: request counts and latency histograms' })
  @ApiProduces('text/plain')
  scrape(): string {
    return this.metrics.render();
  }
}
