'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createTranslator, type Locale, type Translator } from '@kenyaairways/shared';

interface I18nValue {
  t: Translator;
  locale: Locale;
}

/**
 * Client-side translator. Server components call `getTranslator()` directly;
 * client islands get the same `t` through this provider, which the root layout
 * populates with the active locale's catalog (serializable props only).
 */
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Record<string, string>;
  children: ReactNode;
}) {
  const value = useMemo<I18nValue>(
    () => ({ locale, t: createTranslator(messages) }),
    [locale, messages],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() must be used inside <I18nProvider>');
  return ctx;
}
