import { afterEach, describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { AppError } from '@flight13/shared';
import { CallbackIpGuard, clientIp } from './callback-ip.guard';

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

/** Allowlist source under test: the effective (env or admin) config. */
function guardWith(allowlist: () => string[]): CallbackIpGuard {
  return new CallbackIpGuard({ callbackAllowlist: async () => allowlist() });
}

describe('CallbackIpGuard (Daraja/Stripe callback allowlist)', () => {
  let allowlist: string[] = [];
  afterEach(() => {
    allowlist = [];
  });

  it('allows every source when no allowlist is configured (dev default)', async () => {
    allowlist = [];
    await expect(guardWith(() => allowlist).canActivate(context('196.201.214.200'))).resolves.toBe(
      true,
    );
  });

  it('accepts listed IPs, including the x-forwarded-for first hop', async () => {
    allowlist = ['196.201.214.200', '1.2.3.4'];
    const guard = guardWith(() => allowlist);
    await expect(guard.canActivate(context('196.201.214.200'))).resolves.toBe(true);
    await expect(guard.canActivate(context('10.0.0.1', '1.2.3.4, 10.0.0.1'))).resolves.toBe(true);
  });

  it('rejects unlisted sources with FORBIDDEN', async () => {
    allowlist = ['1.2.3.4'];
    await expect(guardWith(() => allowlist).canActivate(context('6.6.6.6'))).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    // still an AppError instance, not a plain rejection
    const thrown = await guardWith(() => allowlist)
      .canActivate(context('6.6.6.6'))
      .catch((err: unknown) => err);
    expect(thrown).toBeInstanceOf(AppError);
  });

  it('clientIp prefers x-forwarded-for over the socket address', () => {
    expect(
      clientIp({ ip: '10.0.0.9', headers: { 'x-forwarded-for': '8.8.4.4, 10.0.0.9' } } as never),
    ).toBe('8.8.4.4');
    expect(clientIp({ ip: '10.0.0.9', headers: {} } as never)).toBe('10.0.0.9');
  });
});
