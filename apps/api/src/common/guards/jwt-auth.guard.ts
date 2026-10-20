import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '@kenyaairways/shared';
import { PrismaService } from '../../prisma/prisma.module';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthUser, AuthedRequest } from '../auth-request';
import { ACCESS_COOKIE, TokenService } from '../../modules/auth/token.service';

/**
 * Accepts the access token from `Authorization: Bearer …` or the httpOnly
 * `f13_at` cookie, verifies it, then reloads the user so a disabled account or
 * a role change takes effect on the very next request.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = extractAccessToken(req);
    if (!raw) throw new AppError('UNAUTHENTICATED', 'Authentication required');

    const { sub, fam } = await this.tokens.verifyAccess(raw);
    if (await this.tokens.isFamilyDenied(fam)) {
      // Logout / refresh-reuse revoked this session before the JWT expired.
      throw new AppError('UNAUTHENTICATED', 'Session revoked');
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) throw new AppError('UNAUTHENTICATED', 'Account no longer exists');
    if (user.status !== 'ACTIVE') throw new AppError('FORBIDDEN', 'Account is not active');

    const auth: AuthUser = {
      id: user.id,
      role: user.role,
      email: user.email,
      phone: user.phone,
      locale: user.locale,
    };
    req.user = auth;
    return true;
  }
}

function extractAccessToken(
  req: Request & { cookies?: Record<string, string> },
): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  const cookie = req.cookies?.[ACCESS_COOKIE];
  if (cookie) return cookie as string;
  // Test/dev convenience only; production traffic uses the cookie or Bearer.
  const bearer = req.headers['x-access-token'];
  return Array.isArray(bearer) ? bearer[0] : bearer;
}
