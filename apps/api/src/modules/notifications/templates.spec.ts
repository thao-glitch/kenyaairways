import { describe, expect, it } from 'vitest';
import { NOTIFICATION_CODES, renderNotification, templateLang } from './templates';

/**
 * i18n contract for server-rendered notifications — the same guarantee
 * messages.test.ts gives the web catalog: every code exists in both locales,
 * placeholders line up, and Swahili is actually Swahili.
 */
describe('notification templates', () => {
  const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

  it('covers every code in both locales', () => {
    expect([...NOTIFICATION_CODES].sort()).toEqual(
      [
        'otp.login',
        'otp.refund',
        'otp.reset_password',
        'otp.change_phone',
        'otp.verify_phone',
        'checkin.completed',
        'ticket.issued',
      ].sort(),
    );
  });

  it('keeps placeholders identical between en and sw', () => {
    for (const code of NOTIFICATION_CODES) {
      const en = renderNotification(code, 'en-KE', {});
      const sw = renderNotification(code, 'sw-KE', {});
      expect(placeholders(sw.subject), `${code} subject`).toEqual(placeholders(en.subject));
      expect(placeholders(sw.body), `${code} body`).toEqual(placeholders(en.body));
    }
  });

  it('actually translates: every sw string differs from en', () => {
    for (const code of NOTIFICATION_CODES) {
      const en = renderNotification(code, 'en-KE', {});
      const sw = renderNotification(code, 'sw-KE', {});
      expect(sw.subject, `${code} subject is untranslated`).not.toBe(en.subject);
      expect(sw.body, `${code} body is untranslated`).not.toBe(en.body);
      expect(sw.subject.trim().length, `${code} subject empty`).toBeGreaterThan(0);
      expect(sw.body.trim().length, `${code} body empty`).toBeGreaterThan(0);
    }
  });

  it('interpolates known vars and leaves unknown placeholders visible', () => {
    const issued = renderNotification('ticket.issued', 'en-KE', {
      pnr: 'ZU986Z',
      tickets: '0131234567890',
    });
    expect(issued.subject).toBe('Tickets issued for ZU986Z');
    expect(issued.body).toBe('Your Kenya Airways ticket number(s): 0131234567890');

    const otp = renderNotification('otp.login', 'sw-KE', { code: '123456', minutes: 10 });
    expect(otp.body).toContain('123456');
    expect(otp.body).toContain('10');

    const partial = renderNotification('checkin.completed', 'en-KE', { pnr: 'X' });
    expect(partial.body).toContain('{seats}'); // missing var stays visible, never "undefined"
  });

  it('maps locales: sw-KE → sw, everything else → en', () => {
    expect(templateLang('sw-KE')).toBe('sw');
    expect(templateLang('SW-ke')).toBe('sw');
    expect(templateLang('en-KE')).toBe('en');
    expect(templateLang('de-DE')).toBe('en');
    expect(templateLang(null)).toBe('en');

    const german = renderNotification('ticket.issued', 'de-DE', { pnr: 'A', tickets: 'B' });
    expect(german.subject).toBe('Tickets issued for A');
  });
});
