/**
 * EN/SW parity for the admin offline-tools copy: every key must exist in
 * both dictionaries, with the same `{placeholder}` set. A missing or
 * drifted translation fails the build.
 */
import { describe, expect, it } from 'vitest';
import { ADMIN_MESSAGE_DICTS, ADMIN_LOCALES, t } from './messages';

const PLACEHOLDER_RE = /\{(\w+)\}/g;

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).sort();
}

describe('admin messages i18n parity', () => {
  const [en, sw] = [ADMIN_MESSAGE_DICTS.en, ADMIN_MESSAGE_DICTS.sw];
  const enKeys = Object.keys(en).sort();

  it('has the same keys in both languages', () => {
    expect(Object.keys(sw).sort()).toEqual(enKeys);
  });

  it('covers every declared locale', () => {
    for (const locale of ADMIN_LOCALES) {
      expect(Object.keys(ADMIN_MESSAGE_DICTS[locale]).sort()).toEqual(enKeys);
    }
  });

  it('has no empty strings', () => {
    for (const key of enKeys) {
      expect(en[key as keyof typeof en].trim()).not.toBe('');
      expect(sw[key as keyof typeof sw].trim()).not.toBe('');
    }
  });

  it('keeps the same placeholders per key', () => {
    for (const key of enKeys) {
      const k = key as keyof typeof en;
      expect(placeholders(sw[k]), `placeholders differ for "${key}"`).toEqual(placeholders(en[k]));
    }
  });

  it('differs from English on at least the shell keys (real translations)', () => {
    // Guards against a copy-pasted dictionary that never got translated.
    expect(sw.signIn).not.toBe(en.signIn);
    expect(sw.bookings).not.toBe(en.bookings);
    expect(sw.payments).not.toBe(en.payments);
  });

  it('substitutes placeholders at call time', () => {
    expect(t('en', 'signedInAs', { name: 'Amina' })).toBe('Signed in as Amina');
    expect(t('sw', 'signedInAs', { name: 'Amina' })).toContain('Amina');
  });
});
