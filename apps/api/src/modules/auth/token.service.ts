import { Injectable, type OnModuleInit } from '@nestjs/common';
import { errors, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Response } from 'express';
import type { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.module';
import { RedisService } from '../../redis/redis.module';
import { getEnv } from '../../config/env';
import { randomToken, sha256 } from '../../common/crypto';
import { AppError } from '@flight13/shared';

/** Cookie names — httpOnly, so page JavaScript can never read either token. */
export const ACCESS_COOKIE = 'f13_at';
export const REFRESH_COOKIE = 'f13_rt';

export type TokenKind = 'access' | 'refresh';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

interface AccessClaims extends JWTPayload {
  typ: TokenKind;
  fam: string;
}
interface RefreshClaims extends JWTPayload {
  typ: TokenKind;
  fam: string;
}

/**
 * Issues and verifies the JWT pair:
 * - access: short-lived HS256 JWT (cookie + `Authorization: Bearer`)
 * - refresh: HS256 JWT whose SHA-256 is stored server-side (RefreshToken row),
 *   which makes rotation and reuse-detection possible: a presented refresh token
 *   must match a *live* row, and seeing a revoked row means the token leaked.
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private accessKey!: Uint8Array;
  private refreshKey!: Uint8Array;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    const env = getEnv();
    this.accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    this.refreshKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET);
  }

  private keys(): { access: Uint8Array; refresh: Uint8Array } {
    if (!this.accessKey) this.onModuleInit();
    return { access: this.accessKey, refresh: this.refreshKey };
  }

  async issueAccess(userId: string, role: Role, familyId: string): Promise<string> {
    const env = getEnv();
    const { access } = this.keys();
    // `fam` lets the guard check the family denylist so logout is immediate.
    return new SignJWT({ typ: 'access', role, fam: familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(randomToken(16))
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + env.ACCESS_TOKEN_TTL)
      .sign(access);
  }

  private async signRefresh(userId: string, familyId: string): Promise<string> {
    const env = getEnv();
    const { refresh } = this.keys();
    return new SignJWT({ typ: 'refresh', fam: familyId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(randomToken(16))
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) + env.REFRESH_TOKEN_TTL)
      .sign(refresh);
  }

  /** Creates a brand-new refresh family (login/register). */
  async issueSession(userId: string, role: Role, meta: SessionMeta): Promise<IssuedSession> {
    const env = getEnv();
    const familyId = randomToken(12);
    const refreshToken = await this.signRefresh(userId, familyId);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    return { accessToken: await this.issueAccess(userId, role, familyId), refreshToken };
  }

  /** Verifies an access token's signature/claims (no DB read — caller loads the user). */
  async verifyAccess(token: string): Promise<{ sub: string; role: Role; fam: string }> {
    const { access } = this.keys();
    try {
      const { payload } = await jwtVerify<AccessClaims>(token, access, { algorithms: ['HS256'] });
      if (payload.typ !== 'access' || !payload.sub || !payload.fam) {
        throw new AppError('UNAUTHENTICATED', 'Invalid access token');
      }
      return { sub: payload.sub, role: payload.role as Role, fam: payload.fam };
    } catch (err) {
      throw normalizeJwtError(err);
    }
  }

  /**
   * Rotates a refresh token. Returns the new pair and revokes the old row;
   * presenting an already-revoked token revokes its whole family (leak response).
   */
  async rotate(raw: string, meta: SessionMeta): Promise<IssuedSession> {
    const env = getEnv();
    const { refresh } = this.keys();
    let payload: RefreshClaims;
    try {
      const verified = await jwtVerify<RefreshClaims>(raw, refresh, { algorithms: ['HS256'] });
      payload = verified.payload;
    } catch (err) {
      throw normalizeJwtError(err);
    }
    if (payload.typ !== 'refresh' || !payload.sub || !payload.fam) {
      throw new AppError('UNAUTHENTICATED', 'Invalid refresh token');
    }

    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new AppError('UNAUTHENTICATED', 'Refresh token expired');
    }
    if (record.revokedAt) {
      // Reuse of a rotated token → assume compromise, kill every descendant.
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.denyFamily(record.familyId);
      throw new AppError('UNAUTHENTICATED', 'Refresh token reuse detected — session revoked');
    }

    const user = await this.prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('UNAUTHENTICATED', 'Account is not active');
    }

    const nextToken = await this.signRefresh(user.id, record.familyId);
    const [, nextRecord] = await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: record.id },
        data: { revokedAt: new Date(), replacedBy: sha256(nextToken) },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(nextToken),
          familyId: record.familyId,
          expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL * 1000),
          ip: meta.ip,
          userAgent: meta.userAgent,
        },
      }),
    ]);
    void nextRecord;

    return {
      accessToken: await this.issueAccess(user.id, user.role, record.familyId),
      refreshToken: nextToken,
    };
  }

  /** Revokes the family behind a presented refresh token (logout). */
  async revoke(raw: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!record) return; // logout must stay idempotent
    await this.prisma.refreshToken.updateMany({
      where: { familyId: record.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.denyFamily(record.familyId);
  }

  /** Family denylist — makes logout/revocation bite before the access JWT expires. */
  private async denyFamily(familyId: string): Promise<void> {
    const env = getEnv();
    try {
      await this.redis.set(`sess:revoked:${familyId}`, 1, env.ACCESS_TOKEN_TTL);
    } catch {
      // Best effort: worst case the access token lives out its 15-minute TTL.
    }
  }

  async isFamilyDenied(familyId: string): Promise<boolean> {
    try {
      return (await this.redis.get<number>(`sess:revoked:${familyId}`)) !== null;
    } catch {
      return false;
    }
  }

  /** Writes both cookies. `res` is the outgoing Express response. */
  setCookies(res: Response, session: IssuedSession): void {
    const env = getEnv();
    const secure = env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, session.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: env.ACCESS_TOKEN_TTL * 1000,
    });
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: env.REFRESH_TOKEN_TTL * 1000,
    });
  }

  clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/' });
  }
}

function normalizeJwtError(err: unknown): AppError {
  if (err instanceof errors.JWTExpired || (err as { code?: string })?.code === 'ERR_JWT_EXPIRED') {
    return new AppError('TOKEN_EXPIRED', 'Access token expired');
  }
  return new AppError('UNAUTHENTICATED', 'Invalid token');
}
