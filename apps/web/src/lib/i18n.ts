import 'server-only';
import { cookies, headers } from 'next/headers';
import { createTranslator, resolveLocale, type Locale, type Translator } from '@flight13/shared';
import en from '@/messages/en.json';
import sw from '@/messages/sw.json';

/**
 * i18n scaffold: English default, Swahili locale wired end to end.
 * Locale resolution order: `locale` cookie (set by the header switcher) →
 * Accept-Language header → en-KE.
 */
const catalogs: Record<Locale, Record<string, string>> = {
  'en-KE': en,
  'sw-KE': sw,
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in catalogs;
}

export async function getLocale(): Promise<Locale> {
  const cookieValue = (await cookies()).get('locale')?.value;
  if (isLocale(cookieValue)) return cookieValue;
  return resolveLocale((await headers()).get('accept-language'));
}

export async function getTranslator(): Promise<{ t: Translator; locale: Locale }> {
  const locale = await getLocale();
  return { t: createTranslator(catalogs[locale]), locale };
}

export { catalogs };
