import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { OtpChannel, OtpPurpose } from '@prisma/client';
import { AppError, DEFAULT_LOCALE, normalizeKenyanPhone } from '@flight13/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { RedisService } from '../../redis/redis.module';
import { getEnv } from '../../config/env';
import { sha256 } from '../../common/crypto';
import { hitRateLimit } from '../../common/rate-limit';
import { createLogger } from '../../common/logger';
import { SmsSender } from '../notifications/sms.sender';
import { renderNotification, type NotificationTemplateCode } from '../notifications/templates';

export interface OtpRequestResult {
  destination: string;
  channel: OtpChannel;
  expiresInSeconds: number;
}

interface Classified {
  channel: OtpChannel;
  destination: string;
}

/** Code generation, delivery and verification for the MFA-ready OTP flow. */
@Injectable()
export class OtpService {
  private readonly log = createLogger('otp');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsSender,
  ) {}

  private classify(raw: string): Classified {
    const value = raw.trim();
    if (value.includes('@')) {
      const email = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError('BAD_REQUEST', 'Invalid email address');
      }
      return { channel: 'EMAIL', destination: email };
    }
    const phone = normalizeKenyanPhone(value);
    if (!phone) throw new AppError('BAD_REQUEST', 'Phone must be a Kenyan number in E.164 format');
    return { channel: 'SMS', destination: phone };
  }

  /** Deterministic, peppered hash — the raw code never reaches the database. */
  private codeHash(purpose: OtpPurpose, destination: string, code: string): string {
    return sha256(`${purpose}:${destination}:${code}:${getEnv().SESSION_COOKIE_SECRET}`);
  }

  async request(rawDestination: string, purpose: OtpPurpose): Promise<OtpRequestResult> {
    const env = getEnv();
    const { channel, destination } = this.classify(rawDestination);

    await hitRateLimit(
      this.redis,
      `otp-req:${destination}`,
      env.RATE_LIMIT_AUTH_MAX,
      env.RATE_LIMIT_WINDOW_MS,
    );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        channel,
        destination,
        purpose,
        codeHash: this.codeHash(purpose, destination, code),
        expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000),
      },
    });

    const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
    // The destination may belong to a known account — render in their locale.
    const owner = await this.prisma.user.findFirst({
      where: { OR: [{ email: destination }, { phone: destination }] },
      select: { id: true, locale: true },
    });
    const templateCode = `otp.${purpose.toLowerCase()}` as NotificationTemplateCode;
    const { subject, body } = renderNotification(templateCode, owner?.locale ?? DEFAULT_LOCALE, {
      code,
      minutes,
    });
    const { providerRef } = await this.sms.send(destination, body);
    await this.prisma.notification.create({
      data: {
        userId: owner?.id ?? null,
        channel: channel === 'SMS' ? 'SMS' : 'EMAIL',
        templateCode,
        recipient: destination,
        subject,
        body,
        status: 'SENT',
        providerRef,
        sentAt: new Date(),
      },
    });

    this.log.info('otp issued', { destination, purpose, channel });
    return { destination, channel, expiresInSeconds: env.OTP_TTL_SECONDS };
  }

  async verify(
    rawDestination: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ verified: true; purpose: OtpPurpose; destination: string }> {
    const env = getEnv();
    const { destination } = this.classify(rawDestination);

    await hitRateLimit(
      this.redis,
      `otp-verify:${destination}`,
      env.RATE_LIMIT_AUTH_MAX * 2,
      env.RATE_LIMIT_WINDOW_MS,
    );

    const record = await this.prisma.otpCode.findFirst({
      where: { destination, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw new AppError('OTP_INVALID', 'No active verification code');
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('OTP_EXPIRED', 'Verification code expired');
    }
    if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
      await this.consume(record.id);
      throw new AppError('OTP_INVALID', 'Too many incorrect attempts — request a new code');
    }

    const matches = record.codeHash === this.codeHash(purpose, destination, code);
    if (!matches) {
      await this.prisma.otpCode.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      throw new AppError('OTP_INVALID', 'Incorrect verification code');
    }

    await this.consume(record.id);

    if (purpose === 'VERIFY_PHONE') {
      await this.prisma.user.updateMany({
        where: { phone: destination },
        data: { phoneVerifiedAt: new Date() },
      });
    }

    this.log.info('otp verified', { destination, purpose });
    return { verified: true, purpose, destination };
  }

  private async consume(id: string): Promise<void> {
    await this.prisma.otpCode.update({ where: { id }, data: { consumedAt: new Date() } });
  }
}
