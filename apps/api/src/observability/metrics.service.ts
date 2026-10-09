import { Injectable } from '@nestjs/common';

/** Fixed latency buckets in seconds (Prometheus-style, cumulative). */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10] as const;

interface Series {
  buckets: number[]; // cumulative count per BUCKETS entry
  sum: number;
  count: number;
}

/**
 * Dependency-free in-process metrics registry (M10): request counters and
 * latency histograms keyed by route *template* (`/api/v1/flights/:id`), so
 * labels stay bounded. Rendered as Prometheus text exposition at `/metrics`.
 */
@Injectable()
export class MetricsService {
  /** `"<method> <route> <status>"` → count */
  private readonly requests = new Map<string, number>();
  /** `"<method> <route>"` → latency series */
  private readonly durations = new Map<string, Series>();

  observe(method: string, route: string, status: number, seconds: number): void {
    const requestKey = `${method} ${route} ${status}`;
    this.requests.set(requestKey, (this.requests.get(requestKey) ?? 0) + 1);

    const durationKey = `${method} ${route}`;
    let series = this.durations.get(durationKey);
    if (!series) {
      series = { buckets: new Array<number>(BUCKETS.length).fill(0), sum: 0, count: 0 };
      this.durations.set(durationKey, series);
    }
    for (let i = 0; i < BUCKETS.length; i += 1) {
      if (seconds <= BUCKETS[i]!) series.buckets[i]! += 1;
    }
    series.sum += seconds;
    series.count += 1;
  }

  /** Prometheus text exposition (version 0.0.4). */
  render(): string {
    const lines: string[] = [
      '# HELP http_requests_total Total HTTP responses by method, route and status.',
      '# TYPE http_requests_total counter',
    ];
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split(' ');
      lines.push(
        `http_requests_total{method="${method}",route="${route}",status="${status}"} ${value}`,
      );
    }
    lines.push(
      '# HELP http_request_duration_seconds Latency of handled HTTP requests, cumulative buckets.',
    );
    lines.push('# TYPE http_request_duration_seconds histogram');
    for (const [key, series] of this.durations) {
      const [method, route] = key.split(' ');
      const labels = `method="${method}",route="${route}"`;
      BUCKETS.forEach((le, i) => {
        lines.push(
          `http_request_duration_seconds_bucket{${labels},le="${le}"} ${series.buckets[i]}`,
        );
      });
      lines.push(`http_request_duration_seconds_bucket{${labels},le="+Inf"} ${series.count}`);
      lines.push(`http_request_duration_seconds_sum{${labels}} ${series.sum.toFixed(6)}`);
      lines.push(`http_request_duration_seconds_count{${labels}} ${series.count}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
