import type { Role } from '@prisma/client';
import type { Request } from 'express';

/** Claims attached to `req.user` by JwtAuthGuard after token verification. */
export interface AuthUser {
  id: string;
  role: Role;
  email: string | null;
  phone: string | null;
  locale: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
}
