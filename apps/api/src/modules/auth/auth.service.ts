import { Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { SessionUserDto } from '@flight13/shared';
import { AppError, DEFAULT_LOCALE, normalizeKenyanPhone, POLICY_VERSION } from '@flight13/shared';
import type { User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { RedisService } from '../../redis/redis.module';
import { getEnv } from '../../config/env';
import { hitRateLimit } from '../../common/rate-limit';
import { maskDeep } from '../../common/logger';
import type { SessionMeta, IssuedSession } from './token.service';
import { TokenService } from './token.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

const BCRYPT_COST = 10;

export interface AuthContext extends SessionMeta {
  requestId?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
  ) {}

  async register(
    dto: RegisterDto,
    ctx: AuthContext,
  ): Promise<{ session: IssuedSession; user: SessionUserDto }> {
    const env = getEnv();
    if (!dto.acceptTerms) {
      throw new AppError('BAD_REQUEST', 'You must accept the terms and privacy notice');
    }
    if (!dto.email && !dto.phone) {
      throw new AppError('BAD_REQUEST', 'Either an email address or a phone number is required');
    }

    const email = dto.email?.trim().toLowerCase();
    const phone = dto.phone ? normalizeKenyanPhone(dto.phone) : null;
    if (dto.phone && !phone) {
      throw new AppError('BAD_REQUEST', 'Phone must be a Kenyan number in E.164 format');
    }

    if (email && (await this.prisma.user.findUnique({ where: { email } }))) {
      throw new AppError('CONFLICT', 'An account with this email already exists');
    }
    if (phone && (await this.prisma.user.findUnique({ where: { phone } }))) {
      throw new AppError('CONFLICT', 'An account with this phone number already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: {
        email,
        phone,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        locale: dto.locale ?? env.DEFAULT_LOCALE ?? DEFAULT_LOCALE,
        role: 'PASSENGER',
        consents: {
          create: [
            { purpose: 'TERMS', policyVersion: POLICY_VERSION, granted: true, source: 'web' },
            { purpose: 'PRIVACY', policyVersion: POLICY_VERSION, granted: true, source: 'web' },
          ],
        },
      },
    });

    await this.audit('auth.register', { actorId: user.id, outcome: 'SUCCESS', ctx });
    const session = await this.tokens.issueSession(user.id, user.role, ctx);
    return { session, user: toSessionUser(user) };
  }

  async login(
    dto: LoginDto,
    ctx: AuthContext,
  ): Promise<{ session: IssuedSession; user: SessionUserDto }> {
    const env = getEnv();
    // Per-IP throttle first: brute force never reaches the password check.
    if (ctx.ip) {
      await hitRateLimit(
        this.redis,
        `login-ip:${ctx.ip}`,
        env.RATE_LIMIT_AUTH_MAX,
        env.RATE_LIMIT_WINDOW_MS,
      );
    }

    const user = await this.findUserByIdentifier(dto.identifier.trim());
    if (!user || !user.passwordHash) {
      await this.audit('auth.login', {
        outcome: 'FAILURE',
        ctx,
        metadata: { reason: 'unknown_user' },
      });
      throw new AppError('UNAUTHENTICATED', 'Incorrect email/phone or password');
    }
    if (user.status !== 'ACTIVE') {
      await this.audit('auth.login', {
        actorId: user.id,
        outcome: 'DENIED',
        ctx,
        metadata: { reason: 'inactive' },
      });
      throw new AppError('FORBIDDEN', 'Account is not active — contact support');
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError('ACCOUNT_LOCKED', 'Account temporarily locked after repeated failures', {
        retryAfterMinutes: minutes,
      });
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lockNow = failures >= env.LOGIN_MAX_ATTEMPTS;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lockNow ? 0 : failures,
          lockedUntil: lockNow
            ? new Date(Date.now() + env.LOGIN_LOCK_MINUTES * 60_000)
            : user.lockedUntil,
        },
      });
      await this.audit('auth.login', {
        actorId: user.id,
        outcome: 'FAILURE',
        ctx,
        metadata: { reason: 'bad_password', failures, locked: lockNow },
      });
      if (lockNow) {
        throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts', {
          retryAfterMinutes: env.LOGIN_LOCK_MINUTES,
        });
      }
      throw new AppError('UNAUTHENTICATED', 'Incorrect email/phone or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit('auth.login', { actorId: user.id, outcome: 'SUCCESS', ctx });
    const session = await this.tokens.issueSession(user.id, user.role, ctx);
    return { session, user: toSessionUser(user) };
  }

  async refresh(raw: string | undefined, ctx: AuthContext): Promise<IssuedSession> {
    if (!raw) throw new AppError('UNAUTHENTICATED', 'Missing refresh token');
    const session = await this.tokens.rotate(raw, ctx);
    await this.audit('auth.refresh', { outcome: 'SUCCESS', ctx, metadata: { rotated: true } });
    return session;
  }

  async logout(raw: string | undefined, ctx: AuthContext): Promise<void> {
    if (raw) await this.tokens.revoke(raw);
    await this.audit('auth.logout', { outcome: 'SUCCESS', ctx });
  }

  async me(userId: string): Promise<SessionUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('NOT_FOUND', 'User not found');
    return toSessionUser(user);
  }

  private async findUserByIdentifier(identifier: string): Promise<User | null> {
    const email = identifier.toLowerCase();
    if (email.includes('@')) {
      return this.prisma.user.findUnique({ where: { email } });
    }
    const phone = normalizeKenyanPhone(identifier);
    if (!phone) return null;
    return this.prisma.user.findUnique({ where: { phone } });
  }

  private async audit(
    action: string,
    opts: {
      actorId?: string;
      outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
      ctx: AuthContext;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action,
          actorId: opts.actorId,
          outcome: opts.outcome,
          ip: opts.ctx.ip,
          userAgent: opts.ctx.userAgent,
          requestId: opts.ctx.requestId,
          metadata: opts.metadata ? (maskDeep(opts.metadata) as object) : undefined,
        },
      });
    } catch {
      // Auditing must never break the request path; failures land in readyz/alerts.
    }
  }
}

export function toSessionUser(user: User): SessionUserDto {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    locale: user.locale as SessionUserDto['locale'],
    emailVerified: user.emailVerifiedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
  };
}
