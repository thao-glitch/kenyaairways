import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser, AuthedRequest } from '../auth-request';

/** Injects the authenticated user (`req.user`) — never undefined in guarded routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    return ctx.switchToHttp().getRequest<AuthedRequest>().user!;
  },
);
