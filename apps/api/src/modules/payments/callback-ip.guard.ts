import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@flight13/shared';
import { getEnv } from '../../config/env';

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
 * Daraja/Stripe callbacks come from provider infrastructure — when
 * MPESA_ALLOWED_CALLBACK_IPS is configured, only those sources may deliver.
 * Empty list (dev) allows everything; production config requires the list
 * (enforced by env superRefine).
 */
@Injectable()
export class CallbackIpGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const allow = getEnv()
      .MPESA_ALLOWED_CALLBACK_IPS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allow.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    if (ip && allow.includes(ip)) return true;
    throw new AppError('FORBIDDEN', 'Callback source not allowed');
  }
}
