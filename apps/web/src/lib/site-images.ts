import type { SiteImagesDto, SiteSettingsDto } from '@flight13/shared';

/**
 * Built-in photographs (real places, Wikimedia Commons — freely licensed).
 * These are defaults only: the admin appearance console overrides any key
 * with its own https URL, and unset keys keep falling back to these.
 *
 * Attribution (Commons files, CC-licensed — see docs/design/README.md):
 * hero       A clash of worlds - Nairobi skyline from the Nairobi National park.jpg
 * auth       Kenya Airways Flight.jpg
 * notFound   Hot Air Balloon Safari in Maasai Mara.jpg
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
const W = 'https://upload.wikimedia.org/wikipedia/commons/thumb';

export const DEFAULT_IMAGES: Required<Pick<SiteImagesDto, 'hero' | 'auth' | 'notFound'>> & {
  destinations: Record<string, string>;
} = {
  hero: `${W}/e/e9/A_clash_of_worlds_-_Nairobi_skyline_from_the_Nairobi_National_park.jpg/1920px-A_clash_of_worlds_-_Nairobi_skyline_from_the_Nairobi_National_park.jpg`,
  auth: `${W}/a/ac/Kenya_Airways_Flight.jpg/1920px-Kenya_Airways_Flight.jpg`,
  notFound: `${W}/4/41/Hot_Air_Balloon_Safari_in_Maasai_Mara.jpg/1920px-Hot_Air_Balloon_Safari_in_Maasai_Mara.jpg`,
  destinations: {
    NBO: `${W}/8/83/Nairobi_skyline_P1000019.jpg/1920px-Nairobi_skyline_P1000019.jpg`,
    WIL: `${W}/6/6e/Wilson_Airport_02.jpg/1920px-Wilson_Airport_02.jpg`,
    MBA: `${W}/e/ed/Maasai_Mara_savanna_landscape%2C_Kenya.jpg/1920px-Maasai_Mara_savanna_landscape%2C_Kenya.jpg`,
    KIS: `${W}/1/18/Kisumu_City_view.jpg/1920px-Kisumu_City_view.jpg`,
    EDL: `${W}/e/e0/Eldoret_Daima_towers_viewed_along_Uganda_Road_Near_Rupa_Mall.jpg/1920px-Eldoret_Daima_towers_viewed_along_Uganda_Road_Near_Rupa_Mall.jpg`,
    MYD: `${W}/2/2d/Malindi_beach_Kenya.jpg/1920px-Malindi_beach_Kenya.jpg`,
    LAU: `${W}/8/80/Lamu_old_town_street.jpg/1920px-Lamu_old_town_street.jpg`,
    EBB: `${W}/7/7e/Entebbe_Aerial.jpg/1920px-Entebbe_Aerial.jpg`,
    DAR: `${W}/b/bc/Dar_es_Salaam_City_Skyline.jpg/1920px-Dar_es_Salaam_City_Skyline.jpg`,
    JNB: `${W}/9/95/Johannesburg_skyline_2017.jpg/1920px-Johannesburg_skyline_2017.jpg`,
    DXB: `${W}/c/cc/Dubai_Skyline_mit_Burj_Khalifa_%2818241030269%29.jpg/1920px-Dubai_Skyline_mit_Burj_Khalifa_%2818241030269%29.jpg`,
    LHR: `${W}/6/6d/Heathrow_Airport_Terminal_5.jpg/1920px-Heathrow_Airport_Terminal_5.jpg`,
  },
};

/** Hero / auth / 404 photograph, honoring admin overrides. */
export function siteImage(
  settings: SiteSettingsDto | null | undefined,
  key: 'hero' | 'auth' | 'notFound',
): string {
  return settings?.images?.[key] || DEFAULT_IMAGES[key];
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
  return (
    settings?.images?.destinations?.[normalized] ||
    DEFAULT_IMAGES.destinations[normalized] ||
    siteImage(settings, 'hero')
  );
}
