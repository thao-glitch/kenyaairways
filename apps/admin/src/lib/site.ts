import 'server-only';
import type { SiteSettingsDto } from '@flight13/shared';
import { apiGetOrNull } from './api';

/**
 * Effective site appearance (theme + photographs + paybill), fetched
 * server-side with a short revalidation window so admin console edits show
 * up within a minute and a flaky API never breaks a page (callers must
 * tolerate `null` and fall back to defaults).
 */
export async function getSiteSettings(): Promise<SiteSettingsDto | null> {
  return apiGetOrNull<SiteSettingsDto>('/api/v1/site-settings', { revalidate: 60 });
}
