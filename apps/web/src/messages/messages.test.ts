import { describe, expect, it } from 'vitest';
import { createTranslator } from '@kenyaairways/shared';
import en from './en.json';
import sw from './sw.json';

/**
 * Locale catalog contract: English is the source of truth, Swahili must stay
 * key-complete so no user ever sees a raw message key.
 */
describe('i18n message catalogs', () => {
  const enKeys = Object.keys(en).sort();
  const swKeys = Object.keys(sw).sort();

  it('has identical key sets in en and sw', () => {
    expect(swKeys).toEqual(enKeys);
  });

  it('has no empty translations', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `en.${key}`).toBeTruthy();
    }
    for (const [key, value] of Object.entries(sw)) {
      expect(value, `sw.${key}`).toBeTruthy();
    }
  });

  it('keeps placeholders consistent between locales', () => {
    const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();
    for (const key of enKeys) {
      const enValue = (en as Record<string, string>)[key];
      const swValue = (sw as Record<string, string>)[key];
      expect(placeholders(swValue), `placeholders differ for ${key}`).toEqual(
        placeholders(enValue),
      );
    }
  });

  it('actually translates: sw differs from en for every key but the brand/language labels', () => {
    // These three are identical by design — a brand name and the names of the
    // two language options themselves. Anything else equal means a missing
    // translation that key-completeness alone would not catch.
    const identicalByDesign = new Set(['app.name', 'nav.english', 'nav.swahili']);
    const equal: string[] = [];
    for (const key of enKeys) {
      const enValue = (en as Record<string, string>)[key];
      const swValue = (sw as Record<string, string>)[key];
      if (swValue === enValue) equal.push(key);
    }
    expect(new Set(equal)).toEqual(identicalByDesign);
  });

  it('interpolates variables and falls back to the key when missing', () => {
    const t = createTranslator(en);
    expect(t('home.network.subtitle', { count: 12 })).toContain('12');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
});
