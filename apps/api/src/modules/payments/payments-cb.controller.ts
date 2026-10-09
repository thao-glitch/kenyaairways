import { timingSafeEqual } from 'node:crypto';
import { Controller, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import Stripe from 'stripe';
import { AppError, C2B_VALIDATION } from '@flight13/shared';
import { Public } from '../../common/decorators/public.decorator';
import { getEnv } from '../../config/env';
import { createLogger } from '../../common/logger';
import { PaymentsService } from './payments.service';
import { CallbackIpGuard } from './callback-ip.guard';

const log = createLogger('payments-cb');

/**
 * Neutral callback surface — the path deliberately carries no provider names
 * (`/api/v1/payments/cb/:secret/...`), only an unguessable secret. Route order
 * matters: the concrete sub-routes (`c2b/validate`, `c2b/confirm`) are declared
 * before the parameterised sibling segments they nest under.
 *
 * Every handler: secret check (timing-safe) → schema validation → fast ack.
 * Heavy processing happens in BullMQ (payments-cb queue), never here.
 */
@Public()
@UseGuards(CallbackIpGuard)
@ApiTags('callbacks')
@Controller('payments/cb')
export class PaymentsCbController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':secret/c2b/validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Daraja C2B validation (pre-money: unknown accounts rejected)' })
  async c2bValidate(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<Record<string, string>> {
    assertCallbackSecret(secret);
    return this.payments.validateC2B(parseJsonBody(req));
  }

  @Post(':secret/c2b/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Daraja C2B confirmation (money moved — deduped by TransID)' })
  @ApiResponse({ status: 200, description: 'Accepted' })
  async c2bConfirm(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<Record<string, string>> {
    assertCallbackSecret(secret);
    await this.payments.ingestC2BConfirm(parseJsonBody(req));
    return { ...C2B_VALIDATION.ACCEPT };
  }

  @Post(':secret/stk')
  @HttpCode(200)
  @ApiOperation({ summary: 'Daraja STK result (ack fast — processing is queued)' })
  @ApiResponse({ status: 200, description: 'ResultCode 0 = accepted for processing' })
  async stk(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    assertCallbackSecret(secret);
    const result = await this.payments.ingestStkCallback(parseJsonBody(req));
    return {
      ResultCode: 0,
      ResultDesc: 'Accepted',
      ...(result.reason ? { note: result.reason } : {}),
    };
  }

  @Post(':secret/stripe')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stripe webhook (signature-verified; live mode only)' })
  @ApiResponse({ status: 404, description: 'STRIPE_MODE=mock — webhook disabled' })
  async stripe(
    @Param('secret') secret: string,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    assertCallbackSecret(secret);
    const env = getEnv();
    if (env.STRIPE_MODE !== 'live') {
      throw new AppError('NOT_FOUND', 'Stripe webhooks are disabled (STRIPE_MODE=mock)');
    }
    const signature = req.headers['stripe-signature'];
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
    let event: Stripe.Event;
    try {
      event = new Stripe(env.STRIPE_SECRET_KEY).webhooks.constructEvent(
        raw,
        typeof signature === 'string' ? signature : '',
        env.STRIPE_WEBHOOK_SECRET,
      );
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Invalid Stripe signature');
    }
    await this.payments.ingestStripeEvent(event);
    return { received: true };
  }
}

/** Timing-safe secret check — wrong secret looks like a 404, not a 401. */
export function assertCallbackSecret(candidate: string): void {
  const expected = getEnv().MPESA_CALLBACK_SECRET;
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('NOT_FOUND', 'Not found');
  }
}

/**
 * Callback bodies are parsed by the path-scoped `express.raw` parser mounted
 * in app.setup (Stripe verifies raw bytes). Decode here — Buffer or object.
 */
export function parseJsonBody(req: Request): unknown {
  const body = req.body;
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      throw new AppError('VALIDATION_ERROR', 'Body is not valid JSON');
    }
  }
  if (body && typeof body === 'object') return body;
  log.warn('callback without body', { path: req.path });
  throw new AppError('VALIDATION_ERROR', 'Empty callback body');
}
