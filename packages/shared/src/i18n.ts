import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from './constants';

export { DEFAULT_LOCALE, SUPPORTED_LOCALES };
export type { Locale };

/** Picks the best supported locale from an Accept-Language style string. */
export function resolveLocale(input?: string | null): Locale {
  if (!input) return DEFAULT_LOCALE;
  const candidates = input
    .split(',')
    .map((part) => part.split(';')[0]?.trim().toLowerCase() ?? '')
    .filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.startsWith('sw')) return 'sw-KE';
    if (candidate.startsWith('en')) return 'en-KE';
  }
  return DEFAULT_LOCALE;
}

export type MessageVars = Record<string, string | number>;

/**
 * Minimal ICU-less translator: `t('booking.confirmed', { pnr: 'ABC123' })`
 * interpolates `{pnr}` placeholders. Message catalogs live in
 * apps/web/src/messages/{en,sw}.json.
 */
export type Translator = (key: string, vars?: MessageVars) => string;

export function createTranslator(messages: Record<string, string>): Translator {
  return (key, vars) => {
    const template = messages[key];
    if (template === undefined) return key;
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  };
}
