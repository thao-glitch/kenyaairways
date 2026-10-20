/**
 * Notification templates rendered server-side, per the booking/recipient
 * locale (`en-KE` / `sw-KE`). English is the source of truth; Swahili must
 * cover every code with the same placeholders — pinned by templates.spec.ts,
 * mirroring the web catalog contract in messages.test.ts.
 */

export type NotificationTemplateCode =
  | 'otp.login'
  | 'otp.verify_phone'
  | 'otp.reset_password'
  | 'otp.change_phone'
  | 'otp.refund'
  | 'ticket.issued'
  | 'checkin.completed';

type Lang = 'en' | 'sw';
type Vars = Record<string, string | number>;
type Rendered = { subject: string; body: string };

const OTP: Record<Lang, Rendered> = {
  en: {
    subject: 'Kenya Airways verification code',
    body: 'Kenya Airways: your verification code is {code}. Valid for {minutes} minute(s). Never share it.',
  },
  sw: {
    subject: 'Msimbo wa uthibitisho wa Kenya Airways',
    body: 'Kenya Airways: msimbo wako wa uthibitisho ni {code}. Halali kwa dakika {minutes}. Usimpe mtu yeyote.',
  },
};

const TEMPLATES: Record<NotificationTemplateCode, Record<Lang, Rendered>> = {
  'otp.login': OTP,
  'otp.verify_phone': OTP,
  'otp.reset_password': OTP,
  'otp.change_phone': OTP,
  'otp.refund': OTP,
  'ticket.issued': {
    en: {
      subject: 'Tickets issued for {pnr}',
      body: 'Your Kenya Airways ticket number(s): {tickets}',
    },
    sw: {
      subject: 'Tiketi zimetolewa kwa {pnr}',
      body: 'Namba zako za tiketi za Kenya Airways: {tickets}',
    },
  },
  'checkin.completed': {
    en: {
      subject: 'Checked in — {pnr}',
      body: 'You are checked in. Seats: {seats}. Boarding passes are in your booking.',
    },
    sw: {
      subject: 'Umeifanya check-in — {pnr}',
      body: 'Umeifanya check-in. Viti: {seats}. Vibali vya kuingia ndege vipo kwenye uhifadhi wako.',
    },
  },
};

export const NOTIFICATION_CODES: NotificationTemplateCode[] = Object.keys(
  TEMPLATES,
) as NotificationTemplateCode[];

/** `en-KE` → en, `sw-KE` → sw, anything else → en (source of truth). */
export function templateLang(locale: string | null | undefined): Lang {
  return locale?.toLowerCase().startsWith('sw') ? 'sw' : 'en';
}

/** Interpolates `{name}` placeholders; unknown placeholders stay visible. */
function interpolate(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/**
 * Renders a template in the subject's locale. Unknown codes fall back to a
 * minimal English shell — every in-repo code is typed at the call site and
 * covered by tests, so the fallback is defence in depth, not a path.
 */
export function renderNotification(
  code: NotificationTemplateCode,
  locale: string | null | undefined,
  vars: Vars,
): Rendered {
  const template = TEMPLATES[code];
  const chosen = (template ? (template[templateLang(locale)] ?? template.en) : undefined) ?? {
    subject: 'Kenya Airways',
    body: '',
  };
  return {
    subject: interpolate(chosen.subject, vars),
    body: interpolate(chosen.body, vars),
  };
}
