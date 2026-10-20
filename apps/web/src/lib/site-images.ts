import type { SiteSettingsDto } from '@kenyaairways/shared';
import { API_URL } from './config';

/**
 * Built-in photographs (real places, Wikimedia Commons — freely licensed).
 * The files are bundled with the app under `public/photos/` so every
 * background renders even offline or when Wikimedia rate-limits hotlinks.
 * These are defaults only: the admin appearance console overrides any key
 * with its own uploaded file or https URL, and unset keys keep falling back
 * to these.
 *
 * Attribution (Commons files, CC-licensed — see docs/design/README.md):
 * hero       A clash of worlds - Nairobi skyline from the Nairobi National park.jpg
 * auth       Kenya Airways Flight.jpg
 * notFound   Hot Air Balloon Safari in Maasai Mara.jpg
 * explore    Hot air ballon safari Maasai Mara National Reserve Kenya.jpg
 * plan       Buffalo Nairobi Skyline Savannah Kenya May19 R1600769.jpg
 * manage     Heathrow Airport Terminal 5.jpg
 * experience Kenya Airways, 5Y-KZF, Boeing 787-8 Dreamliner (49596478088).jpg
 * rewards    Lounge at BLR.JPG
 * holidays   Diani Beach overlooking the Indian Ocean.jpg
 * Nairobi    Nairobi skyline P1000019.jpg
 * Wilson     Wilson Airport 02.jpg
 * Maasai Mara Maasai Mara savanna landscape, Kenya.jpg
 * Kisumu     Kisumu City view.jpg
 * Eldoret    Eldoret Daima towers viewed along Uganda Road Near Rupa Mall.jpg
 * Malindi    Malindi beach Kenya.jpg
 * Lamu       Lamu old town street.jpg
 * Entebbe    Entebbe Aerial.jpg
 * Dar        Dar es Salaam City Skyline.jpg
 * Joburg     Johannesburg skyline 2017.jpg
 * Dubai      Dubai Skyline mit Burj Khalifa (18241030269).jpg
 * London     Heathrow Airport Terminal 5.jpg
 */
/** Photographs ship with the app under `public/photos/` (same key names). */
const P = '/photos';

/** Section backdrops behind the Explore / Plan / Manage / Experience / Rewards pages. */
export const SECTION_IMAGE_KEYS = [
  'explore',
  'plan',
  'manage',
  'experience',
  'rewards',
  'holidays',
] as const;
export type SectionImageKey = (typeof SECTION_IMAGE_KEYS)[number];

export type SiteImageKey = 'hero' | 'auth' | 'notFound' | SectionImageKey;

export const DEFAULT_IMAGES: Record<SiteImageKey, string> & {
  destinations: Record<string, string>;
} = {
  hero: `${P}/hero.jpg`,
  auth: `${P}/auth.jpg`,
  notFound: `${P}/not-found.jpg`,
  explore: `${P}/explore.jpg`,
  plan: `${P}/plan.jpg`,
  manage: `${P}/manage.jpg`,
  experience: `${P}/experience.jpg`,
  rewards: `${P}/rewards.jpg`,
  holidays: `${P}/holidays.jpg`,
  destinations: {
    NBO: `${P}/nbo.jpg`,
    WIL: `${P}/wil.jpg`,
    MBA: `${P}/mba.jpg`,
    KIS: `${P}/kis.jpg`,
    EDL: `${P}/edl.jpg`,
    MYD: `${P}/myd.jpg`,
    LAU: `${P}/lau.jpg`,
    EBB: `${P}/ebb.jpg`,
    DAR: `${P}/dar.jpg`,
    JNB: `${P}/jnb.jpg`,
    DXB: `${P}/dxb.jpg`,
    LHR: `${P}/manage.jpg`,
  },
};

/**
 * Admin uploads are stored as API-relative paths (`/api/v1/media/…`) and
 * must resolve against the API origin. Bundled defaults (`/photos/…`) are
 * served by this app itself, and https URLs pass through untouched.
 */
export function resolveImage(src: string): string {
  return src.startsWith('/api/') ? `${API_URL}${src}` : src;
}

/** Section / hero / auth / 404 photograph, honoring admin overrides. */
export function siteImage(settings: SiteSettingsDto | null | undefined, key: SiteImageKey): string {
  return resolveImage(
    (settings?.images?.[key as string] as string | undefined) || DEFAULT_IMAGES[key],
  );
}

/**
 * Destination photograph for an airport code. Unknown airports (new routes
 * added worldwide) fall back to the hero so a card is never empty.
 */
export function destinationImage(
  settings: SiteSettingsDto | null | undefined,
  code: string,
): string {
  const normalized = code.toUpperCase();
  return resolveImage(
    settings?.images?.destinations?.[normalized] ||
      DEFAULT_IMAGES.destinations[normalized] ||
      settings?.images?.hero ||
      DEFAULT_IMAGES.hero,
  );
}
