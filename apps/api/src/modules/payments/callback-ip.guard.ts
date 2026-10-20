import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@kenyaairways/shared';
import { MethodConfigService } from './config/method-config.service';

/**
 * Client IP for callback allowlisting: honours x-forwarded-for (first hop)
 * when present, else express' req.ip.
 */
export function clientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip ?? undefined;
}

/**
 * Daraja/Stripe callbacks come from provider infrastructure — when the
 * callback IP allowlist is configured (env default or admin override on the
 * payment-plans tab), only those sources may deliver. Empty list (dev)
 * allows everything; production config requires the list (enforced by env
 * superRefine at boot).
 */
@Injectable()
export class CallbackIpGuard implements CanActivate {
  constructor(
    @Inject(MethodConfigService)
    private readonly methods: Pick<MethodConfigService, 'callbackAllowlist'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allow = await this.methods.callbackAllowlist();
    if (allow.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    if (ip && allow.includes(ip)) return true;
    throw new AppError('FORBIDDEN', 'Callback source not allowed');
  }
}
