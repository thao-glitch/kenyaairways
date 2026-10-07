import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'requiredRoles';

/**
 * Grants a route to the listed roles only. No implicit hierarchy — ADMIN does
 * not silently pass FINANCE-only checks; each route declares who may call it.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
