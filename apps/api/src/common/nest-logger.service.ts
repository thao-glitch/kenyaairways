import type { LoggerService } from '@nestjs/common';
import { createLogger, type Logger } from './logger';

/** Routes NestJS lifecycle output through our structured JSON logger. */
export class AppNestLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(context = 'nest') {
    this.logger = createLogger(context);
  }

  log(message: unknown, context?: string): void {
    this.logger.info(this.text(message), { context });
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.logger.error(this.text(message), { context, trace });
  }

  warn(message: unknown, context?: string): void {
    this.logger.warn(this.text(message), { context });
  }

  debug(message: unknown, context?: string): void {
    this.logger.debug(this.text(message), { context });
  }

  verbose(message: unknown, context?: string): void {
    this.logger.debug(this.text(message), { context });
  }

  private text(message: unknown): string {
    if (message instanceof Error) return message.stack ?? message.message;
    if (typeof message === 'string') return message;
    try {
      return JSON.stringify(message);
    } catch {
      return String(message);
    }
  }
}
