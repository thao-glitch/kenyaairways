import { SetMetadata } from '@nestjs/common';

/** Marks a route (or controller) as reachable without an access token. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
