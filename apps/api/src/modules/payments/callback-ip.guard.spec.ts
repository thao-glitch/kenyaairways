import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AppError } from '@flight13/shared';
import { CallbackIpGuard, clientIp } from './callback-ip.guard';
import { getEnv } from '../../config/env';

function context(ip?: string, forwarded?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        ip,
        headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('CallbackIpGuard (Daraja/Stripe callback allowlist)', () => {
  const env = getEnv();
  const original = env.MPESA_ALLOWED_CALLBACK_IPS;
  afterEach(() => {
    env.MPESA_ALLOWED_CALLBACK_IPS = original;
  });

  it('allows every source when no allowlist is configured (dev default)', () => {
    env.MPESA_ALLOWED_CALLBACK_IPS = '';
    expect(new CallbackIpGuard().canActivate(context('196.201.214.200'))).toBe(true);
  });

  it('accepts listed IPs, including the x-forwarded-for first hop', () => {
    env.MPESA_ALLOWED_CALLBACK_IPS = '196.201.214.200, 1.2.3.4';
    const guard = new CallbackIpGuard();
    expect(guard.canActivate(context('196.201.214.200'))).toBe(true);
    expect(guard.canActivate(context('10.0.0.1', '1.2.3.4, 10.0.0.1'))).toBe(true);
  });

  it('rejects unlisted sources with FORBIDDEN', () => {
    env.MPESA_ALLOWED_CALLBACK_IPS = '1.2.3.4';
    let thrown: unknown;
    try {
      new CallbackIpGuard().canActivate(context('6.6.6.6'));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('FORBIDDEN');
  });

  it('clientIp prefers x-forwarded-for over the socket address', () => {
    expect(
      clientIp({ ip: '10.0.0.9', headers: { 'x-forwarded-for': '8.8.4.4, 10.0.0.9' } } as never),
    ).toBe('8.8.4.4');
    expect(clientIp({ ip: '10.0.0.9', headers: {} } as never)).toBe('10.0.0.9');
  });
});
