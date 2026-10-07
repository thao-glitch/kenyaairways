'use server';

import { cookies } from 'next/headers';
import { isLocale } from '@/lib/i18n';

/** Persists the visitor's locale choice for 12 months. */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = formData.get('locale');
  if (!isLocale(locale)) return;
  (await cookies()).set('locale', locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
}
