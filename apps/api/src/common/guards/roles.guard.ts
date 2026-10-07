import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { AppError } from '@flight13/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthedRequest } from '../auth-request';

/** Enforces `@Roles(...)` after JwtAuthGuard has populated `req.user`. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthedRequest>();
    if (!user) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (!required.includes(user.role)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action');
    }
    return true;
  }
}
